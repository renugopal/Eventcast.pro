import React from 'react';
import { BuilderBlock } from './types';

interface SettingsPanelProps {
  selectedBlock: BuilderBlock | null;
  onUpdate: (id: string, updates: Partial<BuilderBlock>) => void;
}

export function SettingsPanel({ selectedBlock, onUpdate }: SettingsPanelProps) {
  if (!selectedBlock) {
    return (
      <div className="w-80 bg-white border-l border-gray-200 p-4 h-full flex flex-col items-center justify-center text-gray-500 text-center shrink-0">
        <p>Select an element on the canvas to edit its settings.</p>
      </div>
    );
  }

  const handleStyleChange = (key: string, value: string) => {
    onUpdate(selectedBlock.id, {
      styles: {
        ...selectedBlock.styles,
        [key]: value
      }
    });
  };

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full overflow-hidden shrink-0">
      <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
        <h3 className="font-semibold text-gray-800 capitalize flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          {selectedBlock.type} Settings
        </h3>
      </div>
      <div className="p-4 overflow-y-auto flex-1 space-y-6">
        
        {/* Content Section */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-gray-900 border-b pb-1">Content</label>
          
          {(selectedBlock.type === 'text' || selectedBlock.type === 'heading' || selectedBlock.type === 'button') && (
            <textarea 
              className="w-full p-2 border border-gray-300 rounded text-sm min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              value={selectedBlock.content || ''}
              onChange={(e) => onUpdate(selectedBlock.id, { content: e.target.value })}
              placeholder="Enter text here..."
            />
          )}

          {selectedBlock.type === 'image' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Image Source (URL or /assets/...)</label>
              <input 
                type="text"
                className="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                value={selectedBlock.src || ''}
                onChange={(e) => onUpdate(selectedBlock.id, { src: e.target.value })}
                placeholder="/assets/my-image.jpg"
              />
            </div>
          )}
          
          {selectedBlock.type === 'section' && (
             <p className="text-xs text-gray-500">Sections are used to group other elements. Drag elements inside.</p>
          )}
        </div>

        {/* Styling Section */}
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-gray-900 border-b pb-1">Styles</label>
           
           <div className="grid grid-cols-2 gap-4">
             {/* Text Color */}
             <div className="space-y-1">
               <label className="text-xs text-gray-600">Text Color</label>
               <div className="flex items-center gap-2">
                 <input 
                   type="color" 
                   value={(selectedBlock.styles.color as string) || '#000000'}
                   onChange={(e) => handleStyleChange('color', e.target.value)}
                   className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                 />
                 <span className="text-xs text-gray-500 uppercase">{(selectedBlock.styles.color as string) || '#000000'}</span>
               </div>
             </div>

             {/* Background Color */}
             <div className="space-y-1">
               <label className="text-xs text-gray-600">Background</label>
               <div className="flex items-center gap-2">
                 <input 
                   type="color" 
                   value={(selectedBlock.styles.backgroundColor as string) || '#ffffff'}
                   onChange={(e) => handleStyleChange('backgroundColor', e.target.value)}
                   className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                 />
               </div>
             </div>
           </div>

           {/* Font Size */}
           <div className="space-y-1">
             <label className="text-xs text-gray-600 flex justify-between">
                <span>Font Size</span>
                <span>{selectedBlock.styles.fontSize || '16'}px</span>
             </label>
             <input 
                type="range" 
                min="10" 
                max="72" 
                value={(selectedBlock.styles.fontSize as string)?.replace('px', '') || '16'}
                onChange={(e) => handleStyleChange('fontSize', `${e.target.value}px`)}
                className="w-full accent-blue-600"
             />
           </div>

           {/* Padding */}
           <div className="space-y-1">
             <label className="text-xs text-gray-600 flex justify-between">
                <span>Padding</span>
                <span>{selectedBlock.styles.padding || '0'}px</span>
             </label>
             <input 
                type="range" 
                min="0" 
                max="100" 
                value={(selectedBlock.styles.padding as string)?.replace('px', '') || '0'}
                onChange={(e) => handleStyleChange('padding', `${e.target.value}px`)}
                className="w-full accent-blue-600"
             />
           </div>
           
           {/* Text Align */}
           <div className="space-y-1">
             <label className="text-xs text-gray-600">Alignment</label>
             <div className="flex rounded-md shadow-sm">
                {['left', 'center', 'right'].map((align) => (
                  <button
                    key={align}
                    onClick={() => handleStyleChange('textAlign', align)}
                    className={`flex-1 px-2 py-1 text-xs font-medium border ${
                      selectedBlock.styles.textAlign === align 
                        ? 'bg-blue-50 border-blue-500 text-blue-700 z-10' 
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                    } ${align === 'left' ? 'rounded-l-md' : align === 'right' ? 'rounded-r-md' : '-ml-px'}`}
                  >
                    {align.charAt(0).toUpperCase() + align.slice(1)}
                  </button>
                ))}
             </div>
           </div>

        </div>
      </div>
    </div>
  );
}
