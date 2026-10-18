"use client";

import { useActionState, useState } from "react";
import {
  adminDeleteActivityAction,
  adminToggleActivityAction,
} from "@/app/admin/actions";
import type { Activity } from "@/lib/types";

export function AdminActivityRow({ activity }: { activity: Activity }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmCodeInput, setConfirmCodeInput] = useState("");

  const [toggleState, toggleFormAction, isPendingToggle] = useActionState(
    adminToggleActivityAction,
    {},
  );

  const [deleteState, deleteFormAction, isPendingDelete] = useActionState(
    adminDeleteActivityAction,
    {},
  );

  return (
    <>
      <tr>
        <td>
          <div className="admin-table-title">{activity.title}</div>
          <div className="admin-table-desc">{activity.question}</div>
          {toggleState?.error && (
            <div
              style={{ color: "#a83232", fontSize: "11px", marginTop: "4px" }}
            >
              ⚠️ {toggleState.error}
            </div>
          )}
          {toggleState?.success && (
            <div
              style={{ color: "#315a3d", fontSize: "11px", marginTop: "4px" }}
            >
              ✓ {toggleState.success}
            </div>
          )}
        </td>
        <td>
          <span className={`status-pill status-${activity.status}`}>
            {activity.status === "open"
              ? "En curso"
              : activity.status === "closed"
                ? "Cerrada"
                : "Borrador"}
          </span>
        </td>
        <td>
          <span style={{ fontSize: "11px", color: "#61685e" }}>
            {activity.moderation_mode === "automatic"
              ? "Publicación directa"
              : "Con aprobación"}
          </span>
        </td>
        <td>
          <code
            style={{
              background: "#f0eee4",
              padding: "3px 6px",
              borderRadius: "3px",
              fontSize: "11px",
              letterSpacing: "0.5px",
            }}
          >
            {activity.public_code}
          </code>
        </td>
        <td>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {/* Botón de Cierre / Reapertura */}
            <form action={toggleFormAction}>
              <input type="hidden" name="activity_id" value={activity.id} />
              <input
                type="hidden"
                name="status"
                value={activity.status === "open" ? "closed" : "open"}
              />
              <button
                type="submit"
                disabled={isPendingToggle}
                className="admin-btn-action"
                style={{
                  background:
                    activity.status === "open" ? "#fbf8ef" : "#f1f6ed",
                  borderColor:
                    activity.status === "open" ? "#d5c99e" : "#b0cb9f",
                  color: activity.status === "open" ? "#7c6418" : "#2f5c35",
                }}
              >
                {isPendingToggle
                  ? "Actualizando..."
                  : activity.status === "open"
                    ? "Cerrar"
                    : "Reabrir"}
              </button>
            </form>

            {/* Botón para iniciar eliminación con confirmación */}
            <button
              type="button"
              onClick={() => setIsDeleting(true)}
              className="admin-btn-action"
              style={{
                background: "#fdf5f4",
                borderColor: "#e5c2be",
                color: "#923226",
              }}
            >
              Eliminar
            </button>
          </div>
        </td>
      </tr>

      {/* Fila expandible de confirmación de eliminación segura */}
      {isDeleting && (
        <tr style={{ background: "#fdf5f4" }}>
          <td colSpan={5} style={{ padding: "16px 20px" }}>
            <div style={{ maxWidth: "600px" }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "13px",
                  color: "#923226",
                  marginBottom: "6px",
                }}
              >
                ⚠️ Confirmación obligatoria para eliminar conversación
              </div>
              <p
                style={{
                  fontSize: "12px",
                  lineHeight: 1.5,
                  color: "#6b2c24",
                  margin: "0 0 12px",
                }}
              >
                Esta acción eliminará de forma irreversible la actividad y todas
                sus ideas y participantes en cascada. Para confirmar, escribí el
                código público exactamente:{" "}
                <strong>{activity.public_code}</strong>.
              </p>

              <form
                action={deleteFormAction}
                style={{ display: "flex", gap: "10px", alignItems: "center" }}
              >
                <input type="hidden" name="activity_id" value={activity.id} />
                <input
                  type="text"
                  name="confirmation_code"
                  placeholder={activity.public_code}
                  value={confirmCodeInput}
                  onChange={(e) => setConfirmCodeInput(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    border: "1px solid #d99a94",
                    borderRadius: "4px",
                    width: "140px",
                    textTransform: "uppercase",
                  }}
                />
                <button
                  type="submit"
                  disabled={
                    isPendingDelete ||
                    confirmCodeInput.trim().toUpperCase() !==
                      activity.public_code.toUpperCase()
                  }
                  style={{
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: 700,
                    background:
                      confirmCodeInput.trim().toUpperCase() ===
                      activity.public_code.toUpperCase()
                        ? "#a33527"
                        : "#d5aba6",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor:
                      confirmCodeInput.trim().toUpperCase() ===
                      activity.public_code.toUpperCase()
                        ? "pointer"
                        : "not-allowed",
                  }}
                >
                  {isPendingDelete ? "Eliminando..." : "Confirmar Eliminación"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsDeleting(false);
                    setConfirmCodeInput("");
                  }}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    background: "transparent",
                    border: "1px solid #ccc",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>
              </form>

              {deleteState?.error && (
                <div
                  style={{
                    color: "#a83232",
                    fontSize: "11px",
                    marginTop: "8px",
                  }}
                >
                  ⚠️ {deleteState.error}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
