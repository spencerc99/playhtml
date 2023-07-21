import "./home.scss";
import React from "react";
import ReactDOM from "react-dom/client";
import { usePartyState } from "./src/react";

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// TODO: convert the guestbook to react and make the hook to make that possible

function saveName(e: any) {
  localStorage.setItem("name", JSON.stringify(e.currentTarget.value));
}

// const nameInput = document.getElementsByName("name")[0] as HTMLInputElement;
// nameInput.value = localStorage.getItem("name")
//   ? JSON.parse(localStorage.getItem("name")!)
//   : "";
// nameInput.addEventListener("change", saveName);

// local storage useState hook
function useStickyState<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const [value, setValue] = React.useState(() => {
    const stickyValue = window.localStorage.getItem(key);
    return stickyValue !== null ? JSON.parse(stickyValue) : defaultValue;
  });
  React.useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue];
}

function App() {
  const [name, setName] = useStickyState("name", "");
  const [message, setMessage] = useStickyState("message", "");

  const [messages, setMessages] = usePartyState<FormData[]>("guestbook", []);
  const addedEntries = React.useMemo(() => new Set<string>(), []);

  function onSubmitForm(e: React.MouseEvent | React.FormEvent) {
    e.preventDefault();

    const timestamp = Date.now();
    const savedName = name || "someone";
    const newEntry: FormData = {
      name: savedName,
      message: message || "something",
      timestamp,
      id: `${timestamp}-${savedName}`,
    };
    if (addedEntries.has(newEntry.id)) {
      return false;
    }

    setMessages([newEntry, ...messages]);
    addedEntries.add(newEntry.id);
    return false;
  }

  return (
    <div id="guestbook">
      <h2>guestbook</h2>
      <p>say something nice to people who come here...</p>
      <form id="guestbookForm" can-post onSubmit={onSubmitForm}>
        <input
          type="text"
          placeholder="your name"
          value={name}
          required
          onChange={(e) => {
            setName(e.currentTarget.value);
            saveName(e.currentTarget.value);
          }}
        />
        <input
          type="text"
          value={message}
          placeholder="5 chars max, emojis recommended"
          maxLength={10}
          onChange={(e) => setMessage(e.currentTarget.value)}
        />
        <button onClick={onSubmitForm}>submit</button>
      </form>
      <GuestbookList messages={messages} />
    </div>
  );
}

interface GuestbookListProps {
  messages: FormData[];
}
interface FormData {
  id: string;
  name: string;
  message: string;
  timestamp: number;
}

function GuestbookList({ messages }: GuestbookListProps) {
  return (
    <div>
      {messages.map((entry) => {
        const entryDate = new Date(entry.timestamp);
        const time = entryDate.toTimeString().split(" ")[0];
        const isToday = entryDate.toDateString() === new Date().toDateString();
        return (
          <div className="guestbook-entry" key={entry.id}>
            <span className="guestbook-entry-timestamp">
              {!isToday ? entryDate.toDateString() + " " : ""}
              {time}
            </span>
            <span className="guestbook-entry-name">{entry.name}</span>{" "}
            <span className="guestbook-entry-message">{entry.message}</span>
          </div>
        );
      })}
    </div>
  );
}
