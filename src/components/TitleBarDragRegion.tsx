import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type TitleBarDragRegionProps = {
  className?: string;
};

export function TitleBarDragRegion({
  className = "mb-4 flex h-8 shrink-0 items-center justify-center select-none text-sm font-medium text-white/90",
}: TitleBarDragRegionProps) {
  return (
    <div
      className={className}
      data-tauri-drag-region
      onMouseDown={(event) => {
        if (!isTauri() || event.button !== 0) {
          return;
        }

        void getCurrentWindow().startDragging();
      }}
    >
      <span className="pointer-events-none">Unstuck Sensei</span>
    </div>
  );
}
