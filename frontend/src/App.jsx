import React, { useState, useEffect, useMemo } from 'react';
import Header from './components/Header';
import StatsRow from './components/StatsRow';
import ContactList from './components/ContactList';
import ContactDetail from './components/ContactDetail';
import { isToday } from './utils/formatters';

function App() {
  const API_URL = import.meta.env.VITE_API_URL || '';
  const [contacts, setContacts] = useState([]);
  const [currentPhone, setCurrentPhone] = useState(null);
  const [activeContactDetail, setActiveContactDetail] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  // Fetch all contacts
  const fetchContacts = async () => {
    try {
      const res = await fetch(`${API_URL}/crm`);
      if (!res.ok) throw new Error('Failed to fetch CRM data');
      const data = await res.json();
      
      const sortedContacts = data.contacts.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
      setContacts(sortedContacts);
    } catch (error) {
      console.error("Error fetching contacts:", error);
    }
  };

  // Fetch detail for a specific contact
  const fetchContactDetail = async (phone) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_URL}/crm/${phone}`);
      if (!res.ok) throw new Error('Contact not found');
      const data = await res.json();
      setActiveContactDetail(data);
      setCurrentPhone(phone);
    } catch (error) {
      console.error("Error fetching detail:", error);
    } finally {
      setDetailLoading(false);
    }
  };

  // Delete contact
  const deleteContact = async (phone) => {
    try {
      await fetch(`${API_URL}/crm/${phone}`, { method: 'DELETE' });
      setCurrentPhone(null);
      setActiveContactDetail(null);
      fetchContacts(); // Refresh list
    } catch (error) {
      console.error("Error deleting:", error);
      alert("Failed to delete contact");
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchContacts();
    const interval = setInterval(() => {
      fetchContacts();
      // Also refresh active contact if selected
      if (currentPhone) {
        // use silent fetch to avoid loading flash
        fetch(`${API_URL}/crm/${currentPhone}`)
          .then(res => res.json())
          .then(data => setActiveContactDetail(data))
          .catch(err => console.error(err));
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [currentPhone]);

  // Derived state
  const stats = useMemo(() => {
    let newToday = 0;
    let activeToday = 0;
    let totalMsgs = 0;

    contacts.forEach(c => {
      if (isToday(new Date(c.firstSeen))) newToday++;
      if (isToday(new Date(c.lastSeen))) activeToday++;
      totalMsgs += c.messageCount || 0;
    });

    return {
      total: contacts.length,
      newToday,
      activeToday,
      totalMsgs
    };
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return contacts.filter(c => 
      (c.name && c.name.toLowerCase().includes(q)) || 
      (c.phone && c.phone.includes(q))
    );
  }, [contacts, searchQuery]);

  return (
    <>
      <Header 
        contactCount={contacts.length} 
        onRefresh={fetchContacts} 
      />
      
      <StatsRow stats={stats} />
      
      <main className="flex-1 overflow-hidden px-5 pb-5 flex flex-col md:flex-row gap-5">
        <ContactList 
          contacts={filteredContacts}
          currentPhone={currentPhone}
          onSelectContact={fetchContactDetail}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />
        
        <ContactDetail 
          contact={activeContactDetail} 
          loading={detailLoading}
          onDelete={deleteContact}
        />
      </main>
    </>
  );
}

export default App;
