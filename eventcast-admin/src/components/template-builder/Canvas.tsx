import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { BuilderBlock } from './types';
import { BuilderItem } from './BuilderItem';

interface CanvasProps {
  blocks: BuilderBlock[];
  selectedBlockId: string | null;
  onSelect: (id: string) => void;
}

export function Canvas({ blocks, selectedBlockId, onSelect }: CanvasProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'canvas-droppable',
  });

  return (
    <div 
      ref={setNodeRef}
      className={`min-h-full p-8 transition-colors ${isOver && blocks.length === 0 ? 'bg-blue-50/50' : 'bg-white'}`}
    >
      {blocks.length === 0 ? (
        <div className="h-full min-h-[400px] flex items-center justify-center border-2 border-dashed border-gray-300 rounded-lg bg-gray-50">
          <p className="text-gray-500">Drag elements here to build your template</p>
        </div>
      ) : (
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-4 min-h-[400px]">
            {blocks.map((block) => (
              <BuilderItem 
                key={block.id} 
                block={block} 
                isSelected={block.id === selectedBlockId}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(block.id);
                }}
              />
            ))}
          </div>
        </SortableContext>
      )}
    </div>
  );
}
