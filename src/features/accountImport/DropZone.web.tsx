import { useEffect, useState, type ReactNode } from 'react';

import { colors, radius } from '@/constants/theme';
import { imageId, type ImportImage } from '@/services/accountImport/images';

/** Desktop: drag & drop screenshots onto the card, or paste one (Ctrl/⌘+V). */
export const DROP_SUPPORTED = true;

async function toImages(files: File[]): Promise<ImportImage[]> {
  const out: ImportImage[] = [];
  for (const f of files.filter((x) => x.type.startsWith('image/'))) {
    const uri = URL.createObjectURL(f);
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = uri;
    });
    out.push({ id: imageId(), uri, name: f.name || 'Pasted screenshot', width: dims.w, height: dims.h, file: f });
  }
  return out;
}

export function DropZone({ children, onFiles }: { children: ReactNode; onFiles: (images: ImportImage[]) => void }) {
  const [over, setOver] = useState(false);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.some((f) => f.type.startsWith('image/'))) {
        e.preventDefault();
        void toImages(files).then(onFiles);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFiles]);

  return (
    <div
      data-testid="screenshot-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void toImages(Array.from(e.dataTransfer.files)).then(onFiles);
      }}
      style={{ borderRadius: radius.lg, outline: over ? `2px dashed ${colors.accentBright}` : 'none', outlineOffset: 4 }}>
      {children}
    </div>
  );
}
