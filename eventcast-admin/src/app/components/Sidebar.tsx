"use client";

import React from "react";
import { PlusCircle, List, Settings, BarChart3, Image as ImageIcon, LogOut, Layout, Users } from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  handleSignOut: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, handleSignOut }) => {
  const menuItems = [
    { id: 'create', label: 'Create Event', icon: PlusCircle },
    { id: 'list', label: 'All Events', icon: List },
    { id: 'photographers', label: 'Photographers', icon: Users },
    { id: 'moderation', label: 'Moderation', icon: Settings },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'assets', label: 'Asset Library', icon: ImageIcon },
    { id: 'settings', label: 'Account Settings', icon: Settings },
  ];

  return (
    <div className="w-72 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      <div className="p-8">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
            <Layout size={24} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight">EVENTCAST</h1>
            <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Admin Dashboard</p>
          </div>
        </div>

        <nav className="space-y-1">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                activeTab === item.id 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-100 translate-x-1' 
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-8 border-t border-slate-50">
        <button 
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 transition-all duration-200 group"
        >
          <LogOut size={20} className="group-hover:-translate-x-1 transition-transform" />
          Sign Out
        </button>
      </div>
    </div>
  );
};
