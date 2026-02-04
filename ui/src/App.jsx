import React, { useState, useEffect } from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow';
import 'reactflow/dist/style.css';
import { healthcheck, executeGraph, chat } from './nativeBackend.js';

export default function App() {
  const [activeTab, setActiveTab] = useState('dag');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const initialNodes = [
    { id: '1', position: { x: 250, y: 5 }, data: { label: 'LLM Node' }, type: 'default' },
    { id: '2', position: { x: 100, y: 150 }, data: { label: 'Prompt Node' } },
  ];
  const initialEdges = [{ id: 'e1-2', source: '1', target: '2' }];

  useEffect(() => {
    console.log('API base:', import.meta.env.VITE_API_URL || 'http://localhost:9091');
  }, []);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    try {
      const response = await chat([...messages, userMessage]);
      const assistantMessage = { role: 'assistant', content: response.response };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + error.message }]);
    }
    setLoading(false);
  };

  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #ccc' }}>
        <button onClick={() => setActiveTab('dag')} style={{ flex: 1, padding: '10px' }}>DAG Editor</button>
        <button onClick={() => setActiveTab('chat')} style={{ flex: 1, padding: '10px' }}>Chat</button>
      </div>
      {activeTab === 'dag' && (
        <div style={{ flex: 1 }}>
          <ReactFlow nodes={initialNodes} edges={initialEdges} fitView>
            <Background gap={16} />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      )}
      {activeTab === 'chat' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {messages.map((msg, idx) => (
              <div key={idx} style={{ marginBottom: '10px' }}>
                <strong>{msg.role}:</strong> {msg.content}
              </div>
            ))}
            {loading && <div>Loading...</div>}
          </div>
          <div style={{ display: 'flex', padding: '10px', borderTop: '1px solid #ccc' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              style={{ flex: 1, padding: '5px' }}
              placeholder="Type your message..."
            />
            <button onClick={handleSend} disabled={loading} style={{ padding: '5px 10px' }}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
