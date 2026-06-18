import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BuilderBlock } from './types';

interface BuilderItemProps {
  block: BuilderBlock;
  isSelected?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  isOverlay?: boolean;
}

export function BuilderItem({ block, isSelected, onClick, isOverlay }: BuilderItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: block.id,
    data: {
      type: block.type,
      isCanvasItem: true
    }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (isDragging && !isOverlay) {
    return (
      <div 
        ref={setNodeRef} 
        style={style}
        className="opacity-30 border-2 border-dashed border-blue-400 bg-blue-50 h-20 rounded"
      />
    );
  }

  const renderContent = () => {
    // We apply the styles directly to the elements
    const elementStyles = block.styles as React.CSSProperties;

    switch (block.type) {
      case 'heading':
        return <h2 style={elementStyles} className="text-3xl font-bold">{block.content}</h2>;
      case 'text':
        return <p style={elementStyles} className="text-gray-700">{block.content}</p>;
      case 'image':
        return (
          <div style={elementStyles} className="w-full h-48 bg-gray-200 flex items-center justify-center rounded text-gray-500 overflow-hidden">
             {block.src ? <img src={block.src} alt="" className="w-full h-full object-cover" /> : <span>Image Placeholder</span>}
          </div>
        );
      case 'button':
        return <button style={elementStyles} className="px-6 py-2 bg-blue-600 text-white rounded font-medium">{block.content}</button>;
      case 'section':
        return <div style={elementStyles} className="min-h-32 border border-dashed border-gray-300 p-4 rounded text-center text-gray-400">Empty Section</div>;
      default:
        return <div>Unknown Block</div>;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`relative group bg-white rounded border-2 cursor-pointer transition-colors p-4 ${
        isSelected 
          ? 'border-blue-500 shadow-md ring-2 ring-blue-200' 
          : 'border-transparent hover:border-gray-300 hover:shadow-sm'
      }`}
    >
      {/* Drag Handle Indicator */}
      <div className={`absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-gray-300 opacity-0 group-hover:opacity-100 transition-opacity ${isSelected ? 'bg-blue-300 opacity-100' : ''}`} />
      
      {renderContent()}
    </div>
  );
}
