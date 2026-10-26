"use client";

import { QRCodeCanvas } from "qrcode.react";
import { useEffect, useState } from "react";

type ShareQrPanelProps = {
  joinUrl: string;
  publicCode?: string;
  activityId?: string;
  participantCount: number;
  ideaCount: number;
  isOpen?: boolean;
};

export function ShareQrPanel({
  joinUrl,
  publicCode,
  participantCount,
  ideaCount,
}: ShareQrPanelProps) {
  const [effectiveUrl, setEffectiveUrl] = useState(joinUrl);
  const [status, setStatus] = useState("Compartir enlace");

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      const path = publicCode ? `/a/${publicCode}` : new URL(joinUrl).pathname;
      setEffectiveUrl(`${window.location.origin}${path}`);
    }
  }, [joinUrl, publicCode]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(effectiveUrl);
      setStatus("Enlace copiado");
      window.setTimeout(() => setStatus("Compartir enlace"), 1800);
    } catch {
      setStatus("No se pudo copiar");
      window.setTimeout(() => setStatus("Compartir enlace"), 1800);
    }
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Participá en la actividad",
          text: "Participá en esta actividad y compartí tu idea.",
          url: effectiveUrl,
        });
        setStatus("Compartido");
        window.setTimeout(() => setStatus("Compartir enlace"), 1800);
        return;
      }
      await handleCopyLink();
    } catch {
      setStatus("No se pudo compartir");
      window.setTimeout(() => setStatus("Compartir enlace"), 1800);
    }
  };

  const handleDownload = () => {
    const canvas = document.getElementById(
      "share-participation-qr",
    ) as HTMLCanvasElement | null;
    if (!canvas) return;

    try {
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = "qr-participacion.png";
      document.body.append(link);
      link.click();
      link.remove();
      setStatus("QR PNG descargado");
    } catch {
      setStatus("No se pudo descargar el QR");
    }
    window.setTimeout(() => setStatus("Compartir enlace"), 1800);
  };

  return (
    <section
      className="share-qr-panel"
      aria-label="Compartir QR para participar"
    >
      <div className="section-header">
        <div>
          <span className="section-kicker">INVITAR A PARTICIPAR</span>
          <h2>Compartí el acceso</h2>
        </div>
      </div>
      <div className="share-qr-box">
        <div className="share-qr-info">
          <div className="share-qr-url">
            <span>ENLACE PARA PARTICIPAR</span>
            <strong title={effectiveUrl}>
              {(() => {
                try {
                  return new URL(effectiveUrl).pathname;
                } catch {
                  return publicCode ? `/a/${publicCode}` : effectiveUrl;
                }
              })()}
            </strong>
          </div>
          <p>
            Escaneá el QR o compartí el enlace para abrir el formulario y enviar
            una idea.
          </p>
          <div className="share-qr-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={handleShare}
            >
              {status}
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={handleCopyLink}
            >
              Copiar enlace
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={handleDownload}
            >
              Descargar QR
            </button>
          </div>
        </div>
        <div className="share-qr-frame">
          <QRCodeCanvas
            id="share-participation-qr"
            className="share-qr-code"
            value={effectiveUrl}
            size={256}
            style={{ width: 138, height: 138 }}
            level="H"
            marginSize={4}
            imageSettings={{
              src: "/muro-mark.svg",
              width: 48,
              height: 48,
              excavate: true,
              crossOrigin: "anonymous",
            }}
          />
        </div>
        <div className="share-qr-summary">
          <div>
            <span>PARTICIPANTES</span>
            <strong>{participantCount}</strong>
          </div>
          <div>
            <span>IDEAS</span>
            <strong>{ideaCount}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
