"use client";

import { useActionState, useState } from "react";
import {
  adminDeleteIdeaAction,
  adminModerateIdeaAction,
} from "@/app/admin/actions";
import type { Idea } from "@/lib/types";

export function AdminIdeaRow({ idea }: { idea: Idea }) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const [moderateState, moderateFormAction, isPendingModerate] = useActionState(
    adminModerateIdeaAction,
    {},
  );

  const [deleteState, deleteFormAction, isPendingDelete] = useActionState(
    adminDeleteIdeaAction,
    {},
  );

  return (
    <>
      <tr>
        <td>
          <div style={{ maxWidth: "460px", lineHeight: "1.5" }}>
            {idea.content}
          </div>
          {moderateState?.error && (
            <div
              style={{ color: "#a83232", fontSize: "11px", marginTop: "4px" }}
            >
              ⚠️ {moderateState.error}
            </div>
          )}
          {moderateState?.success && (
            <div
              style={{ color: "#315a3d", fontSize: "11px", marginTop: "4px" }}
            >
              ✓ {moderateState.success}
            </div>
          )}
          {deleteState?.error && (
            <div
              style={{ color: "#a83232", fontSize: "11px", marginTop: "4px" }}
            >
              ⚠️ {deleteState.error}
            </div>
          )}
          {deleteState?.success && (
            <div
              style={{ color: "#315a3d", fontSize: "11px", marginTop: "4px" }}
            >
              ✓ {deleteState.success}
            </div>
          )}
        </td>
        <td>
          <span className={`status-pill status-${idea.status}`}>
            {idea.status === "published"
              ? "Publicada"
              : idea.status === "pending"
                ? "Pendiente"
                : "Oculta"}
          </span>
        </td>
        <td style={{ fontSize: "11px", color: "#8a8f86" }}>
          {new Date(idea.created_at).toLocaleDateString("es-AR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}
        </td>
        <td>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {idea.status !== "published" && (
              <form action={moderateFormAction}>
                <input type="hidden" name="idea_id" value={idea.id} />
                <input type="hidden" name="status" value="published" />
                <button
                  type="submit"
                  disabled={isPendingModerate || isPendingDelete}
                  className="admin-btn-action"
                  style={{
                    background: "#f1f6ed",
                    borderColor: "#b0cb9f",
                    color: "#2f5c35",
                  }}
                >
                  {isPendingModerate ? "..." : "Publicar"}
                </button>
              </form>
            )}

            {idea.status !== "hidden" && (
              <form action={moderateFormAction}>
                <input type="hidden" name="idea_id" value={idea.id} />
                <input type="hidden" name="status" value="hidden" />
                <button
                  type="submit"
                  disabled={isPendingModerate || isPendingDelete}
                  className="admin-btn-action"
                  style={{
                    background: "#fdf8ee",
                    borderColor: "#d8c79c",
                    color: "#745814",
                  }}
                >
                  {isPendingModerate ? "..." : "Ocultar"}
                </button>
              </form>
            )}

            {!isConfirmingDelete && (
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(true)}
                disabled={isPendingModerate || isPendingDelete}
                className="admin-btn-action"
                style={{
                  background: "#fdf5f4",
                  borderColor: "#e5c2be",
                  color: "#923226",
                }}
              >
                Eliminar
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Confirmación en dos pasos para borrado individual de idea */}
      {isConfirmingDelete && (
        <tr style={{ background: "#fdf5f4" }}>
          <td colSpan={4} style={{ padding: "12px 16px" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
              }}
            >
              <div style={{ fontSize: "12px", color: "#6b2c24" }}>
                <strong>⚠️ Confirmar eliminación de idea:</strong> Esta acción es
                irreversible y eliminará su relación de autoría en cascada.
              </div>
              <div
                style={{ display: "flex", gap: "8px", alignItems: "center" }}
              >
                <form action={deleteFormAction}>
                  <input type="hidden" name="idea_id" value={idea.id} />
                  <button
                    type="submit"
                    disabled={isPendingDelete}
                    className="admin-btn-action"
                    style={{
                      background: "#923226",
                      borderColor: "#923226",
                      color: "#ffffff",
                    }}
                  >
                    {isPendingDelete
                      ? "Eliminando..."
                      : "Sí, eliminar definitivamente"}
                  </button>
                </form>
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  disabled={isPendingDelete}
                  className="admin-btn-action"
                  style={{
                    background: "#ffffff",
                    borderColor: "#ccc",
                    color: "#555",
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
