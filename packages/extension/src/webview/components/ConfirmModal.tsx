import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';

interface Props {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose,
}: Props) {
  const submit = () => {
    onConfirm();
    onClose();
  };
  return (
    <Modal title={title} onClose={onClose} onSubmit={submit}>
      <div className="text-[12px] leading-relaxed text-foreground/85">{message}</div>
      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <ModalConfirmButton onClick={submit} label={confirmLabel} danger={danger} />
      </ModalFooter>
    </Modal>
  );
}
