-- Migration: Reemplazar política de lectura pública de actividades para restringirla a 'anon' (R1 / H-01)
-- Reemplaza "Anyone can read open or closed activity details" en public.activities
-- para que aplique únicamente al rol anon, conservando la condición status in ('open', 'closed').

drop policy if exists "Anyone can read open or closed activity details" on public.activities;

create policy "Anyone can read open or closed activity details"
  on public.activities
  for select
  to anon
  using (status in ('open', 'closed'));
