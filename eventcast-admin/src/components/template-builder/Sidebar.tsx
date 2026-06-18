import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Type, Image, Layout, Pointer, Heading } from 'lucide-react';
import { BlockType } from './types';

const sidebarTools = [
  { type: 'heading', label: 'Heading', icon: Heading },
  { type: 'text', label: 'Text', icon: Type },
  { type: 'image', label: 'Image', icon: Image },
  { type: 'button', label: 'Button', icon: Pointer },
  { type: 'section', label: 'Section', icon: Layout },
];

function DraggableTool({ tool }: { tool: typeof sidebarTools[0] }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar-${tool.type}`,
    data: {
      type: tool.type,
      isSidebarItem: true,
    }
  });

  return (
    <div 
      ref={setNodeRef} 
      {...listeners} 
      {...attributes}
      className={`flex items-center gap-3 p-3 mb-2 bg-white rounded border cursor-grab hover:border-blue-500 hover:shadow-sm transition-all ${isDragging ? 'opacity-50' : 'opacity-100 border-gray-200'}`}
    >
      <tool.icon className="w-5 h-5 text-gray-500" />
      <span className="font-medium text-sm text-gray-700">{tool.label}</span>
    </div>
  );
}

export function Sidebar() {
  return (
    <div className="w-64 bg-gray-100 border-r border-gray-200 flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-gray-200 bg-white">
        <h3 className="font-semibold text-gray-800">Elements</h3>
      </div>
      <div className="p-4 overflow-y-auto flex-1">
        {sidebarTools.map(tool => (
          <DraggableTool key={tool.type} tool={tool} />
        ))}
      </div>
    </div>
  );
}
