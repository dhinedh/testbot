import React from 'react';

function Header({ contactCount, onRefresh }) {
  return (
    <header className="bg-wa-teal text-white py-4 px-5 flex justify-between items-center shadow-md">
      <div>
        <h1 className="text-xl font-semibold">WhatsApp CRM Dashboard</h1>
        <p className="text-sm opacity-90 mt-1">{contactCount} contacts</p>
      </div>
      <button 
        onClick={onRefresh}
        className="bg-white/20 hover:bg-white/30 text-white border-none py-2 px-4 rounded transition-colors text-sm"
      >
        ↻ Refresh
      </button>
    </header>
  );
}

export default Header;
