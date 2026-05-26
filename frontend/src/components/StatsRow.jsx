import React from 'react';

function StatsRow({ stats }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-5">
      <div className="bg-bg-white p-4 rounded-lg shadow-sm border-b-4 border-wa-green">
        <h3 className="text-sm text-text-muted uppercase mb-1">Total Contacts</h3>
        <div className="text-3xl font-bold text-text-dark">{stats.total}</div>
      </div>
      <div className="bg-bg-white p-4 rounded-lg shadow-sm border-b-4 border-wa-green">
        <h3 className="text-sm text-text-muted uppercase mb-1">New Today</h3>
        <div className="text-3xl font-bold text-text-dark">{stats.newToday}</div>
      </div>
      <div className="bg-bg-white p-4 rounded-lg shadow-sm border-b-4 border-wa-green">
        <h3 className="text-sm text-text-muted uppercase mb-1">Active Today</h3>
        <div className="text-3xl font-bold text-text-dark">{stats.activeToday}</div>
      </div>
      <div className="bg-bg-white p-4 rounded-lg shadow-sm border-b-4 border-wa-green">
        <h3 className="text-sm text-text-muted uppercase mb-1">Total Messages</h3>
        <div className="text-3xl font-bold text-text-dark">{stats.totalMsgs}</div>
      </div>
    </div>
  );
}

export default StatsRow;
