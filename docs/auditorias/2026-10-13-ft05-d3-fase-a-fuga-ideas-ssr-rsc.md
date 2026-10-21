# Informe de Auditoría Dinámica: FT-05 (D-3 Fase A)
## Ausencia de fuga de ideas no publicadas en la respuesta inicial SSR/RSC de `/muro/[code]`

- **Fecha:** 2026-10-13
- **Serie:** Pruebas dinámicas de seguridad FT (FT-05)
- **Alcance evaluado:** Exclusivamente **D-3 Fase A** (renderizado del servidor SSR y serialización RSC para usuarios anónimos, sin ejecución de JavaScript cliente).
- **Exclusiones expresas:** D-3 Fase B (suscripción Realtime / WebSocket) y pruebas dinámicas A6 (`createActivityAction`) y A11 (`deleteActivityAction`), las cuales permanecen sin autorización ni ejecución.

---

## 1. Objetivo y Condiciones de la Prueba

El objetivo de esta prueba es verificar empíricamente que un visitante anónimo que consulta la vista pública del muro (`/muro/[code]`) no recibe, ni en el marcado HTML inicial ni en el payload serializado de React Server Components (RSC / stream Flight), contenido o identificadores de ideas que se encuentren en estados no autorizados para el público general (`pending` o `hidden`).

### Condiciones operativas observadas:
1. Ejecución restringida al entorno desechable aislado `Muro_Audit_D0`.
2. Prohibición estricta de impactar la base de datos de producción o el stack compartido local (`Muro_Partisiativo_de_Ideas`).
3. Captura HTTP anónima sin envío de cookies, tokens de autenticación ni cabeceras con secretos.
4. Generación, verificación criptográfica (SHA-256) y preservación de evidencias antes de la limpieza de datos.
5. Restauración del entorno a cero residuales al finalizar la captura.

---

## 2. Entorno y Controles de Aislamiento

| Control de Aislamiento | Implementación y Verificación | Estado |
|---|---|---|
| **Regla de Firewall de Windows** | Regla `Muro_Audit_D0_TempBlock_5532x` activa (`Enabled: True`, `Direction: Inbound`, `Action: Block`, `Protocol: TCP`, `LocalPort: 55321-55324`, `RemoteAddress: Any`). Previene acceso desde interfaces de red externas/LAN sin alterar reglas preexistentes de Docker. | **Activa / Verificada** |
| **Identidad del Backend Desechable** | Contenedor `supabase_db_Muro_Audit_D0` y gateway `supabase_kong_Muro_Audit_D0` en puertos locales `55321–55324`. | **Aislado** |
| **Stack Compartido Preservado** | Contenedores `*_Muro_Partisiativo_de_Ideas` en puertos `25433–25436` sin tráfico ni escrituras durante la prueba. | **Intacto** |
| **Servidor de Aplicación Aislado** | Instancia de Next.js ejecutada en `127.0.0.1:3001` configurada exclusivamente hacia `127.0.0.1:55321`. | **Aislado** |
| **Prueba de Contraste Cruzado** | Solicitud HTTP a `/muro/D3QRSDZG` contra el servidor del stack compartido (`:3000`) arrojó **HTTP 404**, demostrando que los datos sintéticos no existían fuera del entorno desechable. | **Aislamiento Cruzado Confirmado** |

---

## 3. Identificadores y Centinelas Sintéticos

Se generó una actividad sintética y tres ideas con estados contrastantes utilizando prefijos y tokens únicos seudónimos para trazabilidad exacta:

- **Actividad de prueba:**
  - `id`: `acf6ac55-ca99-4a05-96ae-41b9d8841747`
  - `public_code`: `D3QRSDZG`
  - `title`: `D3A Auditoria (desechable)`
  - `status`: `open`
  - `moderation_mode`: `approval`
  - `owner_id`: `82422dbf-5a41-418d-9059-c7ce2260c48e`
- **Token base:** `TOKMV773DB7`

### Mapeo de Ideas Sintéticas:
| Rol en la Prueba | Estado en DB | ID de Idea | Contenido / Centinela |
|---|---|---|---|
| **Control Positivo** | `published` | `c2fdf5eb-41fb-4954-ae3c-c2ac120a61c0` | `TOKMV773DB7_PUBLISHED_andamiaje_visible` |
| **Control Negativo 1** | `pending` | `e961bb61-2e54-442d-905b-52c6ea75ae59` | `TOKMV773DB7_PENDING_andamiaje_oculto` |
| **Control Negativo 2** | `hidden` | `9500529c-036a-486d-8aad-45848606e691` | `TOKMV773DB7_HIDDEN_andamiaje_oculto` |

---

## 4. Respuesta HTTP y Evidencias Criptográficas

Se realizó una solicitud `GET http://127.0.0.1:3001/muro/D3QRSDZG` con cabeceras de navegador estándar (`Accept: text/html...`), sin cookies de sesión y sin encabezados de autorización.

- **Resultado HTTP:** `200 OK`
- **Artefactos de evidencia capturados:**

| Archivo | Tamaño (bytes) | Hash SHA-256 Verificado |
|---|---|---|
| `d3a_initial_response.html` | 15.549 B | `b0ad6680c1f0e30cbf5ecf3107213c488cdb92fdaf489b265aaada3d0297b10f` |
| `d3a_extracted_rsc_payload.txt` | 7.687 B | `c284523679d7dee0f9047371146c08f920dfce0baae085a30ef66775a8dc1067` |

*Ubicación en entorno de auditoría:*
`C:\Users\lucas\.gemini\antigravity-ide\brain\3d6a5041-663a-46dd-84a0-5068e9ca013e\scratch\d3a\`

---

## 5. Matriz de Criterios de Aceptación

Se analizó el contenido del HTML inicial completo y del payload RSC extraído y decodificado (`self.__next_f.push`):

| Criterio | Elemento Evaluado | Presencia en HTML | Presencia en RSC | Veredicto |
|---|---|:---:|:---:|:---:|
| **Control Positivo** | Centinela `published` (`TOKMV773DB7_PUBLISHED_andamiaje_visible`) | **PRESENTE** | **PRESENTE** | **CUMPLE** |
| **Control Positivo (ID)** | UUID idea `published` (`c2fdf5eb-41fb-4954-ae3c-c2ac120a61c0`) | **PRESENTE** | **PRESENTE** | **CUMPLE** |
| **Control Negativo 1** | Centinela `pending` (`TOKMV773DB7_PENDING_andamiaje_oculto`) | **AUSENTE** | **AUSENTE** | **CUMPLE** |
| **Control Negativo 1 (ID)** | UUID idea `pending` (`e961bb61-2e54-442d-905b-52c6ea75ae59`) | **AUSENTE** | **AUSENTE** | **CUMPLE** |
| **Control Negativo 2** | Centinela `hidden` (`TOKMV773DB7_HIDDEN_andamiaje_oculto`) | **AUSENTE** | **AUSENTE** | **CUMPLE** |
| **Control Negativo 2 (ID)** | UUID idea `hidden` (`9500529c-036a-486d-8aad-45848606e691`) | **AUSENTE** | **AUSENTE** | **CUMPLE** |
| **Datos Sensibles** | `owner_id` de la actividad (`82422dbf-5a41-418d-9059-c7ce2260c48e`) | **AUSENTE** | **AUSENTE** | **CUMPLE** |
| **Datos Sensibles** | Claves de servicio (`service_role` / `sb_secret_`), contraseñas o emails | **AUSENTE** | **AUSENTE** | **CUMPLE** |
| **Integridad RSC** | Estructura de props de `LiveWall` (`activityId`, `publicCode`, `initialIdeas`) | Conforme | Conforme | **CUMPLE** |

### Observación Técnica del Comportamiento:
En `src/app/muro/[code]/page.tsx`, la consulta SSR aplica un filtro estricto por `.eq("status", "published")`, complementado por las directivas RLS públicas que no conceden lectura de ideas no publicadas al rol anónimo. Como consecuencia, las props serializadas que viajan al cliente a través del componente `<LiveWall initialIdeas={...} />` contienen de forma exclusiva las ideas aprobadas.

---

## 6. Verificación de Limpieza y Estado Final

Tras finalizar las lecturas de contraste y hashes, se procedió a la remoción de datos y liberación de recursos:

1. **Entorno Desechable (`supabase_db_Muro_Audit_D0`):**
   - Filas residuales en `public.activities`: **0**
   - Filas residuales en `public.ideas`: **0**
   - Usuarios residuales en `auth.users`: **0**
   - Solicitud posterior a `GET /muro/D3QRSDZG`: Responde **HTTP 404**.
2. **Stack Compartido (`supabase_db_Muro_Partisiativo_de_Ideas`):**
   - Conteo `public.activities`: **18** (sin cambios).
   - Conteo `public.ideas`: **192** (sin cambios).
3. **Procesos y Puertos:**
   - Procesos del servidor de prueba en puerto 3001 terminados.
   - Socket TCP `127.0.0.1:3001` verificado en estado **completamente liberado**.
4. **Regla de Firewall:**
   - `Muro_Audit_D0_TempBlock_5532x` se mantiene activa para salvaguardar el entorno desechable.

---

## 7. Limitaciones del Alcance

1. Este informe se limita **estrictamente a la respuesta inicial del servidor (SSR/RSC)** ante una petición anónima sin JavaScript en el cliente.
2. **No evalúa la entrega en tiempo real** por WebSockets / Supabase Realtime (**D-3 Fase B**), la cual requiere validación independiente de suscripciones `postgres_changes`.
3. **No evalúa acciones del panel de control** ni controles de autorización mutantes de administración (**A6 / A11**).
4. No representa una certificación integral de la seguridad de la aplicación, sino una verificación de ausencia de fuga en el vector específico analizado.

---

## 8. Conclusión

**D-3 FASE A: SUPERADA SATISFACTORIAMENTE.**
La respuesta inicial generada por el servidor para la ruta pública del muro `/muro/[code]` no filtra ideas en estado `pending` ni `hidden` en el marcado HTML ni en los datos serializados RSC para usuarios anónimos. D-3 Fase B y las pruebas dinámicas A6/A11 permanecen pendientes y sin autorización.
