import React, { useState } from "react";
import { withSharedState } from "@playhtml/react";
import { PlayProvider } from "@playhtml/react";
import "./LiveChat.scss";

interface ChatMessage {
  id: string;
  name: string;
  text: string;
  color?: string;
}

interface LiveChatProps {
  name: string;
}

const LiveChat = withSharedState(
  {
    defaultData: { messages: [] as ChatMessage[] },
  },
  ({ data, setData }, { name }) => {
    const [newMessage, setNewMessage] = useState("");
    const [isMinimized, setIsMinimized] = useState(true);
    const userId = localStorage.getItem("userId") || "unknown";
    const userName = Boolean(localStorage.getItem("username"))
      ? JSON.parse(localStorage.getItem("username")) || "Anonymous"
      : "Anonymous";

    const handleSend = () => {
      if (newMessage.trim()) {
        const message = {
          id: userId,
          name: userName,
          text: newMessage,
          //   this comes from cursor party, if not defined it just defaults to black
          //   @ts-ignore
          color: window.cursors.color,
        };
        setData({ messages: [...data.messages, message] });
        setNewMessage("");
      }
    };

    // TODO: add read in local store, handle notifications
    return (
      <div className={`live-chat ${isMinimized ? "minimized" : ""}`}>
        <div
          className="chat-header"
          onClick={() => setIsMinimized(!isMinimized)}
        >
          <h2>{name}</h2>
          <button>{isMinimized ? "⬆︎" : "–"}</button>
        </div>
        {!isMinimized && (
          <>
            <div className="chat-window">
              {data.messages.map((msg, index) => (
                <div key={index} className="chat-message">
                  <strong
                    style={{
                      color: msg.color || "black",
                    }}
                  >
                    {msg.name}
                  </strong>
                  : {msg.text}
                </div>
              ))}
            </div>
            <div className="chat-input">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type your message..."
              />
              <button onClick={handleSend}>Send</button>
            </div>
          </>
        )}
      </div>
    );
  }
);

export const LiveChatController = withSharedState(
  {
    defaultData: { chatNames: [] as string[] },
  },
  ({ data, setData }) => {
    const [newChatName, setNewChatName] = useState("");

    const handleCreateChat = () => {
      if (newChatName.trim() && !data.chatNames.includes(newChatName)) {
        setData({ chatNames: [...data.chatNames, newChatName] });
        setNewChatName("");
      }
    };

    return (
      <div className="live-chat-controller" id="live-chats">
        <div className="chat-list">
          {data.chatNames.map((name, index) => (
            <LiveChat key={index} name={name} />
          ))}
        </div>
        <div className="chat-creation">
          <div>
            <input
              type="text"
              value={newChatName}
              onChange={(e) => setNewChatName(e.target.value)}
              placeholder="Enter chat name..."
            />
            <button onClick={handleCreateChat}>Create Chat</button>
          </div>
        </div>
      </div>
    );
  }
);
