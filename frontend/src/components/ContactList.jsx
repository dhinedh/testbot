import React from 'react';
import { formatLastSeen } from '../utils/formatters';

function ContactList({ contacts, currentPhone, onSelectContact, searchQuery, onSearchChange }) {
  return (
    <div className="w-full md:w-[350px] bg-bg-white rounded-lg flex flex-col shadow-sm border border-border-color/50 h-[500px] md:h-auto flex-shrink-0">
      <div className="p-4 border-b border-border-color">
        <input 
          type="text" 
          placeholder="Search name or phone number..." 
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full py-2 px-4 border border-border-color rounded-full outline-none bg-bg-light text-sm focus:bg-white focus:border-wa-green transition-colors"
        />
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <div className="p-5 text-center text-text-muted text-sm">No contacts found</div>
        ) : (
          contacts.map(contact => {
            const isActive = currentPhone === contact.phone;
            const avatarLetter = contact.name ? contact.name.charAt(0).toUpperCase() : 'W';
            
            return (
              <div 
                key={contact.phone}
                onClick={() => onSelectContact(contact.phone)}
                className={`flex p-3 cursor-pointer border-b border-bg-light transition-colors ${isActive ? 'bg-bg-light' : 'hover:bg-bg-light'}`}
              >
                <div className="w-11 h-11 rounded-full bg-wa-green text-white flex items-center justify-center font-bold text-lg mr-4 shrink-0">
                  {avatarLetter}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-semibold truncate text-text-dark">{contact.name || contact.phone}</span>
                    <span className="text-xs text-text-muted whitespace-nowrap ml-2">
                      {formatLastSeen(contact.lastSeen)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-muted truncate">+{contact.phone}</span>
                    <span className="bg-wa-green text-white text-[10px] py-0.5 px-2 rounded-full font-bold">
                      {contact.messageCount} msgs
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ContactList;
