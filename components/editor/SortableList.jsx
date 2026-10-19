"use client";

import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Vertical drag-to-reorder list for the edit panel. Only the ⠿ handle starts a drag, so the
// inputs inside the rows stay normal (typing, text selection). Keyboard: focus the handle, Space, arrows.
export default function SortableList({ id, ids, onMove, renderItem, disabled }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(active.id);
    const to = ids.indexOf(over.id);
    if (from >= 0 && to >= 0) onMove(from, to);
  }

  return (
    <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <div className="space-y-4">
          {ids.map((rowId, index) => (
            <Row key={rowId} id={rowId} disabled={disabled}>
              {(handle) => renderItem(index, handle)}
            </Row>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function Row({ id, disabled, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Húzd a sorrend módosításához"
      title="Húzd a sorrend módosításához"
      className="cursor-grab touch-none rounded px-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 active:cursor-grabbing dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      ⠿
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 rounded-lg bg-white opacity-90 shadow-lg dark:bg-zinc-900" : ""}
    >
      {children(handle)}
    </div>
  );
}
