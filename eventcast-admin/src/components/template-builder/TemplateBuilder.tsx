"use client";

import React, { useState } from 'react';
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { v4 as uuidv4 } from 'uuid';

import { Sidebar } from './Sidebar';
import { Canvas } from './Canvas';
import { SettingsPanel } from './SettingsPanel';
import { BuilderBlock, BlockType } from './types';
import { BuilderItem } from './BuilderItem';

// Initial placeholder state
const initialBlocks: BuilderBlock[] = [];

export function TemplateBuilder() {
  const [blocks, setBlocks] = useState<BuilderBlock[]>(initialBlocks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (!over) return;

    // Handle dropping a new item from sidebar
    if (active.data.current?.isSidebarItem) {
      const type = active.data.current.type as BlockType;
      
      const newBlock: BuilderBlock = {
        id: uuidv4(),
        type,
        content: type === 'text' ? 'Double click to edit text' : 
                 type === 'heading' ? 'Heading Text' : '',
        styles: {}
      };

      if (over.id === 'canvas-droppable' || blocks.length === 0) {
        // Drop at the end
        setBlocks((prev) => [...prev, newBlock]);
      } else {
        // Drop at specific index
        const overIndex = blocks.findIndex(b => b.id === over.id);
        if (overIndex !== -1) {
          setBlocks((prev) => {
            const newBlocks = [...prev];
            newBlocks.splice(overIndex, 0, newBlock);
            return newBlocks;
          });
        } else {
          setBlocks((prev) => [...prev, newBlock]);
        }
      }
      return;
    }

    // Handle reordering within canvas
    if (active.id !== over.id) {
      setBlocks((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const updateBlock = (id: string, updates: Partial<BuilderBlock>) => {
    setBlocks(blocks.map(block => block.id === id ? { ...block, ...updates } : block));
  };

  const activeBlock = activeId ? blocks.find(b => b.id === activeId) : null;
  const selectedBlock = selectedBlockId ? blocks.find(b => b.id === selectedBlockId) : null;

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-gray-50 text-gray-900">
      <DndContext 
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <Sidebar />
        
        <div className="flex-1 flex flex-col p-8 overflow-y-auto" onClick={() => setSelectedBlockId(null)}>
          <div className="mb-4 flex justify-between items-center">
            <h2 className="text-xl font-bold">Canvas</h2>
            <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
              Save Template
            </button>
          </div>
          
          <div className="flex-1 bg-white shadow-xl rounded-lg border border-gray-200 overflow-hidden min-h-[500px]">
             <Canvas blocks={blocks} selectedBlockId={selectedBlockId} onSelect={setSelectedBlockId} />
          </div>
        </div>

        <SettingsPanel selectedBlock={selectedBlock} onUpdate={updateBlock} />
        
        <DragOverlay>
          {activeBlock ? (
             <div className="opacity-80 scale-105 shadow-2xl">
                <BuilderItem block={activeBlock} isOverlay />
             </div>
          ) : activeId && activeId.startsWith('sidebar-') ? (
             <div className="p-4 bg-white shadow-lg rounded border border-blue-500 font-medium">
                Dragging new element...
             </div>
          ) : null}
        </DragOverlay>

      </DndContext>
    </div>
  );
}
