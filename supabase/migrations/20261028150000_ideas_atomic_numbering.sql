-- Migración: Numeración correlativa atómica por actividad y persistencia de idea_number
-- Fecha: 2026-10-28
-- Autor: Lucas Damián Montero

BEGIN;

-- 1. Adquirir bloqueo exclusivo temporal sobre ideas para garantizar aislamiento durante la migración
LOCK TABLE public.ideas IN EXCLUSIVE MODE;

-- 2. Agregar contador atómico last_idea_number en la tabla de actividades
ALTER TABLE public.activities
ADD COLUMN IF NOT EXISTS last_idea_number integer NOT NULL DEFAULT 0;

-- 3. Agregar columna idea_number en ideas (temporalmente nullable para backfill)
ALTER TABLE public.ideas
ADD COLUMN IF NOT EXISTS idea_number integer;

-- 4. Backfill determinista para ideas existentes respetando el orden canónico estricto (created_at ASC, id ASC)
WITH numbered_existing_ideas AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY activity_id
      ORDER BY created_at ASC, id ASC
    ) as calculated_number
  FROM public.ideas
)
UPDATE public.ideas i
SET idea_number = nei.calculated_number
FROM numbered_existing_ideas nei
WHERE i.id = nei.id
  AND i.idea_number IS NULL;

-- 5. Sincronizar el contador de cada actividad al valor máximo actual
UPDATE public.activities a
SET last_idea_number = COALESCE(
  (SELECT MAX(i.idea_number) FROM public.ideas i WHERE i.activity_id = a.id),
  0
);

-- 6. Endurecer columna idea_number
ALTER TABLE public.ideas
ALTER COLUMN idea_number SET NOT NULL;

-- 7. Restricción de unicidad compuesta por actividad
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ideas_activity_id_idea_number_key'
  ) THEN
    ALTER TABLE public.ideas
    ADD CONSTRAINT ideas_activity_id_idea_number_key
    UNIQUE (activity_id, idea_number);
  END IF;
END $$;

-- 8. Índice para consultas y ordenamiento de alto rendimiento
CREATE INDEX IF NOT EXISTS ideas_activity_status_number_idx
ON public.ideas (activity_id, status, idea_number ASC);

-- 9. Función de asignación atómica strictly BEFORE INSERT
-- Propietario: postgres (ejecutor de migraciones)
-- search_path vacío (set search_path = '') para mitigar ataques de búsqueda de esquemas (CWE-426)
-- Calificación explícita de esquema public.
CREATE OR REPLACE FUNCTION public.assign_idea_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_next_number integer;
BEGIN
  -- Validar que NEW.activity_id no sea nulo
  IF NEW.activity_id IS NULL THEN
    RAISE EXCEPTION 'activity_id no puede ser nulo' USING errcode = '23502';
  END IF;

  -- Bloqueo a nivel de fila y avance monótono sobre la actividad padre
  -- Si NEW.activity_id no existe en public.activities, v_next_number será nulo y la transacción aborta
  UPDATE public.activities
  SET last_idea_number = last_idea_number + 1
  WHERE id = NEW.activity_id
  RETURNING last_idea_number INTO v_next_number;

  IF v_next_number IS NULL THEN
    RAISE EXCEPTION 'Actividad % no encontrada para asignar correlativo de idea', NEW.activity_id USING errcode = 'P0002';
  END IF;

  NEW.idea_number := v_next_number;
  RETURN NEW;
END;
$$;

-- Restricción estricta de ejecución de la función interna
REVOKE ALL ON FUNCTION public.assign_idea_number() FROM PUBLIC, anon, authenticated;

-- 10. Crear trigger BEFORE INSERT
DROP TRIGGER IF EXISTS trg_assign_idea_number ON public.ideas;
CREATE TRIGGER trg_assign_idea_number
BEFORE INSERT ON public.ideas
FOR EACH ROW
EXECUTE FUNCTION public.assign_idea_number();

COMMIT;
