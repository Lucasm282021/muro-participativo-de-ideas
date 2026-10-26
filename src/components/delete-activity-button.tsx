"use client";

import { useRef, useState } from "react";
import { DeleteActivityModal } from "@/components/delete-activity-modal";

export function DeleteActivityButton({
  activityId,
  activityTitle,
}: {
  activityId: string;
  activityTitle: string;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="button button-danger"
        onClick={handleOpenModal}
        aria-haspopup="dialog"
      >
        Eliminar actividad
      </button>

      <DeleteActivityModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        activityId={activityId}
        activityTitle={activityTitle}
      />
    </>
  );
}
