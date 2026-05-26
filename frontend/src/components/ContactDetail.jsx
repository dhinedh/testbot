import React, { useRef, useEffect } from 'react';
import { formatDate, formatTime, formatLastSeen } from '../utils/formatters';

function ContactDetail({ contact, onDelete, loading }) {
  const chatEndRef = useRef(null);

  // Auto scroll to bottom of chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [contact?.messages]);

  if (loading) {
    return (
      <div className="flex-1 bg-white/80 rounded-lg flex items-center justify-center relative shadow-sm border border-border-color/50 h-[500px] md:h-auto z-10">
        <div className="font-bold text-wa-teal text-lg">Loading...</div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex-1 bg-bg-light rounded-lg flex flex-col items-center justify-center relative shadow-sm border border-border-color/50 h-[500px] md:h-auto text-text-muted text-center p-5 z-10">
        <div className="text-5xl mb-4">👋</div>
        <h2 className="text-xl font-semibold mb-2 text-text-dark">No contact selected</h2>
        <p className="text-sm">Click on a contact to view their chat history</p>
        <p className="text-xs mt-3">Or if the list is empty, send a WhatsApp message to get started!</p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#efeae2] rounded-lg flex flex-col relative shadow-sm h-[500px] md:h-auto overflow-hidden">
      {/* Background pattern */}
      <div 
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{ backgroundImage: 'url(\'data:image/svg+xml,%3Csvg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"%3E%3Cpath d="M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM12 86c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm28-65c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm23-11c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-6 60c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm29 22c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zM32 63c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm57-13c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm-9-21c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM60 91c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM35 41c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zM12 60c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z" fill="%23075E54" fill-rule="evenodd"/%3E%3C/svg%3E\')' }}
      ></div>

      <div className="bg-bg-light px-5 py-4 border-b border-border-color flex justify-between items-center z-10">
        <div>
          <h2 className="font-semibold text-lg text-text-dark">{contact.name || contact.phone}</h2>
          <p className="text-sm text-text-muted">+{contact.phone}</p>
        </div>
        <div className="text-right text-xs text-text-muted space-y-1">
          <p>First seen: {formatDate(contact.firstSeen)}</p>
          <p>Last seen: {formatLastSeen(contact.lastSeen)}</p>
        </div>
      </div>
      
      <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-2 z-10">
        {contact.messages && contact.messages.map((msg, idx) => {
          const isButton = msg.text && msg.text.startsWith('btn_');
          const buttonMap = {
            'btn_1': '✅ Services',
            'btn_2': '✅ Pricing',
            'btn_3': '✅ Talk to a human'
          };
          
          if (isButton) {
            return (
              <div key={idx} className="max-w-[70%] px-4 py-1.5 rounded-full text-sm shadow-sm self-end bg-wa-teal/10 border border-wa-teal/30 text-wa-teal font-medium relative text-center mb-1">
                {buttonMap[msg.text] || '✅ Selected Option'}
                <span className="block text-[0.55rem] opacity-60 text-right mt-0.5">
                  {formatTime(msg.time)}
                </span>
              </div>
            );
          }

          return (
            <div key={idx} className="max-w-[70%] px-3 py-2 rounded-lg text-[0.95rem] shadow-[0_1px_1px_rgba(0,0,0,0.1)] self-end bg-bubble-sent relative">
              <span className="break-words" dangerouslySetInnerHTML={{ __html: msg.text.replace(/\n/g, '<br>') }} />
              <span className="block text-[0.65rem] text-text-muted text-right mt-1">
                {formatTime(msg.time)}
              </span>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 bg-bg-light border-t border-border-color text-right z-10">
        <button 
          onClick={() => {
            if (window.confirm("Are you sure you want to delete this contact?")) {
              onDelete(contact.phone);
            }
          }}
          className="bg-white text-danger border border-danger hover:bg-danger hover:text-white px-4 py-2 rounded transition-colors text-sm font-medium"
        >
          Delete Contact
        </button>
      </div>
    </div>
  );
}

export default ContactDetail;
