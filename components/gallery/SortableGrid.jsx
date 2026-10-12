"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Drag-to-reorder grid. A short move starts a drag, so plain clicks on tiles still work;
// on touch a long press starts it (scrolling stays normal).
export default function SortableGrid({ id, items, onReorder, renderItem, disabled, className }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((x) => x.id === active.id);
    const to = items.findIndex((x) => x.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  }

  return (
    <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((x) => x.id)} strategy={rectSortingStrategy} disabled={disabled}>
        <div className={className}>
          {items.map((item) => (
            <Tile key={item.id} id={item.id} disabled={disabled}>
              {renderItem(item)}
            </Tile>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function Tile({ id, disabled, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`touch-manipulation ${isDragging ? "relative z-10 opacity-80 shadow-lg" : ""}`}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
