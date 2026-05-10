import { Modal, ModalFooter, ModalCancelButton, ModalConfirmButton } from './Modal';

interface Props {
  onChoose: (mode: 'reseed' | 'open-as-is') => void;
  onClose: () => void;
}

/**
 * Pops when the user clicks "Load Demo Project" but `~/aidlc-demo-project`
 * already exists. Replaces the VS Code notification chrome with an inline
 * modal so the affordance lives in the same surface as the button.
 */
export function LoadDemoModal({ onChoose, onClose }: Props) {
  return (
    <Modal
      title="Demo project already exists"
      subtitle={
        <>
          <span className="font-mono text-foreground/80">~/aidlc-demo-project</span>
        </>
      }
      onClose={onClose}
    >
      <div className="space-y-2 text-[12px] leading-relaxed text-foreground/85">
        <p>What would you like to do?</p>
        <ul className="ml-3 list-disc space-y-1 text-[11.5px] text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground/80">Re-seed and open</span> —
            wipes <span className="font-mono">.aidlc/</span> and{' '}
            <span className="font-mono">docs/epics/</span>, writes fresh demo data,
            then opens the folder.
          </li>
          <li>
            <span className="font-semibold text-foreground/80">Open as-is</span> —
            keep the existing files (your edits / new epics) and just open the folder.
          </li>
        </ul>
      </div>

      <ModalFooter>
        <ModalCancelButton onClick={onClose} />
        <button
          type="button"
          onClick={() => {
            onChoose('open-as-is');
            onClose();
          }}
          className="rounded-md border border-border px-3 py-1.5 text-[11.5px] font-medium text-foreground hover:border-border/80 hover:bg-accent"
        >
          Open as-is
        </button>
        <ModalConfirmButton
          onClick={() => {
            onChoose('reseed');
            onClose();
          }}
          label="Re-seed and open"
          danger
        />
      </ModalFooter>
    </Modal>
  );
}
