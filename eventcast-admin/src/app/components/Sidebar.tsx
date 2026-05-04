"use client";

import React from "react";
import { PlusCircle, List, Settings, BarChart3, Image as ImageIcon, LogOut, Layout, Users, Home, Monitor, ChevronLeft, ChevronRight } from "lucide-react";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  handleSignOut: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isCollapsed, setIsCollapsed, handleSignOut }) => {
    const menuItems = [
    { id: 'home', label: 'Dashboard Home', icon: Home },
    { id: 'monitor', label: 'Live Monitor', icon: Monitor },
    { id: 'create', label: 'Create Event', icon: PlusCircle },
    { id: 'list', label: 'All Events', icon: List },
    { id: 'photographers', label: 'Photographers', icon: Users },
    { id: 'moderation', label: 'Moderation', icon: Settings },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'assets', label: 'Asset Library', icon: ImageIcon },
    { id: 'settings', label: 'Account Settings', icon: Settings },
  ];

  return (
    <div className={`bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0 transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-72'}`}>
      <div className={`p-6 ${isCollapsed ? 'items-center' : ''} flex flex-col`}>
        <div className="flex items-center gap-3 mb-10 overflow-hidden">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex-shrink-0 flex items-center justify-center text-white shadow-lg shadow-blue-200">
            <Layout size={24} />
          </div>
          {!isCollapsed && (
            <div className="animate-in fade-in slide-in-from-left-2 duration-300">
              <h1 className="text-xl font-black text-slate-800 tracking-tight">EVENTCAST</h1>
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Admin Dashboard</p>
            </div>
          )}
        </div>

        <nav className="space-y-1">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={isCollapsed ? item.label : ""}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                activeTab === item.id 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-100 translate-x-1' 
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
            >
              <item.icon size={20} className="flex-shrink-0" />
              {!isCollapsed && <span className="animate-in fade-in duration-300">{item.label}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-6 space-y-4">
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-full flex items-center gap-3 px-4 py-2 rounded-xl text-xs font-black text-slate-400 hover:bg-slate-50 hover:text-slate-800 transition-all border border-transparent hover:border-slate-100"
        >
          {isCollapsed ? <ChevronRight size={18} className="mx-auto" /> : (
            <>
              <ChevronLeft size={18} />
              <span>Collapse Sidebar</span>
            </>
          )}
        </button>
        
        <button 
          onClick={handleSignOut}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 transition-all duration-200 group ${isCollapsed ? 'justify-center px-0' : ''}`}
        >
          <LogOut size={20} className={`${!isCollapsed && 'group-hover:-translate-x-1'} transition-transform flex-shrink-0`} />
          {!isCollapsed && <span className="animate-in fade-in duration-300">Sign Out</span>}
        </button>
      </div>
    </div>
  );
};
