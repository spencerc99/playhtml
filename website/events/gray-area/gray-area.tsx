import ReactDOM from "react-dom";
import "./gray-area.scss";
import randomColor from "randomcolor";
import React, { useEffect } from "react";
import { PlayProvider, withSharedState } from "@playhtml/react";

const NumCursors = 50;

function Cursors() {
  return (
    <div>
      {Array.from({ length: NumCursors }).map((_, i) => {
        const distanceX =
          Math.random() * 400 + 200 * (Math.random() > 0.5 ? 1 : -1);
        const distanceY =
          Math.random() * 400 + 200 * (Math.random() > 0.5 ? 1 : -1);
        // scale duration with distance
        const duration = Math.sqrt(distanceX ** 2 + distanceY ** 2) * 0.03;
        const color = randomColor({
          luminosity: "bright",
          format: "hsla",
          alpha: 0.8,
        });
        return (
          <img
            key={i}
            className="cursor"
            style={{
              "--bg-color": color,
              "--starting-x": `${Math.random() * 100}vw`,
              "--starting-y": `${Math.random() * 100}vh`,
              "--distance-x": `${distanceX}px`,
              "--distance-y": `${distanceY}px`,
              "--duration": `${duration}s`,
            }}
            src={`data:image/svg+xml,%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 28 28' enable-background='new 0 0 28 28' xml:space='preserve'%3E%3Cpolygon fill='${encodeURIComponent(
              color
            )}' points='8.2,20.9 8.2,4.9 19.8,16.5 13,16.5 12.6,16.6 '/%3E%3Cpolygon fill='${encodeURIComponent(
              color
            )}' points='17.3,21.6 13.7,23.1 9,12 12.7,10.5 '/%3E%3Crect x='12.5' y='13.6' transform='matrix(0.9221 -0.3871 0.3871 0.9221 -5.7605 6.5909)' fill='${encodeURIComponent(
              color
            )}' width='2' height='8'/%3E%3Cpolygon fill='${encodeURIComponent(
              color
            )}' points='9.2,7.3 9.2,18.5 12.2,15.6 12.6,15.5 17.4,15.5 '/%3E%3C/svg%3E`}
          />
        );
      })}
    </div>
  );
}

const Timer = withSharedState(
  {
    defaultData: { time: 0, isRunning: false },
  },
  ({ data, setData }) => {
    const { time, isRunning } = data;

    useEffect(() => {
      let interval;
      if (isRunning) {
        interval = setInterval(() => {
          setData({ time: time + 1, isRunning });
        }, 1000);
      } else if (!isRunning && time !== 0) {
        clearInterval(interval);
      }
      return () => clearInterval(interval);
    }, [isRunning, time, setData]);

    const handleStartPause = () => {
      setData({ time, isRunning: !isRunning });
    };

    const handleReset = () => {
      setData({ time: 0, isRunning: false });
    };

    const formatTime = (time) => {
      const hours = String(Math.floor(time / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((time % 3600) / 60)).padStart(2, "0");
      const seconds = String(time % 60).padStart(2, "0");
      return `${hours}:${minutes}:${seconds}`;
    };

    return (
      <div id="timer" className="retro-timer">
        <h2>{formatTime(time)}</h2>
        <div className="buttons">
          <button onClick={handleStartPause}>
            {isRunning ? "Pause" : "Start"}
          </button>
          <button onClick={handleReset}>Reset</button>
        </div>
      </div>
    );
  }
);

function PlayhtmlToolBox() {
  return (
    <div id="playhtml-tools">
      <div
        id="timerWrapper"
        can-move=""
        style={{
          width: "fit-content",
          position: "absolute",
          right: 0,
        }}
      >
        <Timer />
      </div>
    </div>
  );
}

function useStickyState<T = any>(
  key: string,
  defaultValue: T,
  onUpdateCallback?: (value: T) => void
): [T, (value: T) => void] {
  const [value, setValue] = React.useState(() => {
    const stickyValue = window.localStorage.getItem(key);
    return stickyValue !== null ? JSON.parse(stickyValue) : defaultValue;
  });
  React.useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
    onUpdateCallback?.(value);
  }, [key, value]);
  return [value, setValue];
}

function Main() {
  const [name, setName] = useStickyState<string | null>(
    "username",
    null,
    (newName) => {
      window.cursors?.setName(newName);
    }
  );
  const [from, setFrom] = useStickyState<string | null>("from", null);

  return (
    <PlayProvider>
      <Cursors />
      <div id="workshopContent">
        <PlayhtmlToolBox />
        <section>
          <h3>hi welcome to "neighborhood internets"</h3>
          <p>
            get settled, introduce yourself to your neighbor, and open your
            laptop to do the following:
            <ol>
              <li>
                open{" "}
                <a href="https://playhtml.fun/events/gray-area">
                  https://playhtml.fun/events/gray-area
                </a>
              </li>
              <li>
                join this{" "}
                <a href="https://discord.gg/pSK5cBtm">discord channel</a> (we'll
                be using it as our class chat to share links, etc.)
              </li>
            </ol>
          </p>
          <p>
            we'll wait a bit for everyone to get here to get started :) in the
            meanwhile, if you're on this site, you can play around with some of
            the objects here.
          </p>
        </section>
        <section>
          <h3>what will we do today</h3>
          <ul
            style={{
              marginTop: 6,
            }}
          >
            <li>make a collaborative website experience using playhtml</li>
            <li>
              play each other's websites and expand our idea of what the web can
              be
            </li>
            <li>have fun :)</li>
          </ul>
          <br />
          <em>disclaimers</em>
          <ul
            style={{
              marginTop: 6,
            }}
          >
            <li>this is beta software that i made and now maintain</li>
            <li>
              there might be some bugs!
              <ul>
                <li>
                  (but i've used it for tens of thousands of visitors on my own
                  websites, so you can totally use it)
                </li>
                <li>
                  all of this is part of handmade / community-maintained
                  software :) we're in this together
                </li>
              </ul>
            </li>
            <li>
              i ask that you be understanding and generous with your thoughts,
              everything can be changed!
            </li>
          </ul>
          <p>
            p.s. this website is collaborative and you can follow along with me:{" "}
            <a href="https://playhtml.fun/events/gray-area">
              https://playhtml.fun/events/gray-area
            </a>
          </p>
        </section>
        <section>
          <h3>your hosts</h3>
          <div
            style={{
              display: "flex",
              gap: ".5em",
              marginBottom: "1em",
            }}
          >
            <img
              style={{
                width: "160px",
                borderRadius: "8px",
              }}
              src="https://i0.wp.com/grayarea.org/wp-content/uploads/2024/03/jumping-spencer-square.jpg?fit=435,435&ssl=1"
            />
            <div>
              <b>Spencer Chang</b>
              <p>
                indie artist, engineer, designer making computers that feel like
                ours.
              </p>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: ".5em",
            }}
          >
            <img
              style={{
                width: "160px",
                borderRadius: "8px",
              }}
              src="https://avatars.githubusercontent.com/u/4564870?v=4"
            />
            <div>
              <b>Alejandro García Salas</b>
              <p>
                peruvian software engineer based in San Francisco, California.
              </p>
            </div>
          </div>
          <br />
          <p>
            <em>
              (and thank you to Andre from Gray Area for helping us set up &
              Gray Area for hosting us!)
            </em>
          </p>
        </section>
        <section>
          <h3>let's get to know each other a bit</h3>
          <ul>
            <li>
              what's your name?{" "}
              <input
                placeholder="name"
                value={name || ""}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </li>
            <li>
              where are you from? <input placeholder="from?" />
            </li>
            <li>
              what are you excited for today and/or what do you wish the web was
              like?
            </li>
            <li>experience with code?</li>
          </ul>
          {/* TODO: hook up interactive sign up */}
        </section>
        <section>
          <h3>what is playhtml?</h3>
          <ul>
            <li>
              <a href="https://playhtml.fun">open-source infrastructure</a> for
              making tiny social networks (and other communal digital
              experiences) that spencer made / maintains
            </li>
            <ul>
              <li>
                (slowly becoming my main toolbox for creating my art and web
                experiences)
              </li>
            </ul>
            <li>
              vision is to be something that the community adds on to and
              maintains and people can share their own collaborative components
            </li>
          </ul>
          <p>core aspects are that it is</p>
          <ol>
            <li>
              real-time collaborative (so everyone is looking at the{" "}
              <em>same</em> thing) and
            </li>
            <li>
              persistent (everything you do has effects that are preserved even
              after you close the page)
            </li>
          </ol>
          <p>
            and it requires no server (on your part) and can be done with pure
            HTML and CSS for simple things and vanilla javascript for more
            complex things (or react if you're into that)
          </p>
          <br />
          <p>examples:</p>
          <ul>
            <li>
              <a href="https://playhtml.fun/fridge">fridge poetry</a>
            </li>
            <li>
              <a href="https://playhtml.fun/experiments/4">every color</a>
            </li>
          </ul>
        </section>
        <section>
          <h3>let's dip our toes with making something!!!!!</h3>
          <ul>
            <li>
              copy this{" "}
              <a href="https://glitch.com/edit/#!/honored-cubic-arthropod">
                glitch template
              </a>
            </li>
            <li>
              let's play around for 10 mins here. I'd suggest finding different
              ways to replace the image, etc.
            </li>
            <li>
              let's focus on trying out all the different capabilities with
              different assets. try playing around with those around you to get
              a feel for how it feels to be together on the same site!
            </li>
          </ul>
          {/* TODO: <p>demonstrations for each capability</p> */}
          <p>
            <strong>tips and tricks</strong>
          </p>
          <ul>
            <li>
              make sure each element has an ID! this makes it such that playhtml
              knows which element to associate the data with
            </li>
            <li>
              for creating custom capabilities
              <ul>
                <li>
                  if things aren't working or you're stuck in a bad state,
                  switch out IDs so that the data resets
                </li>
              </ul>
            </li>
            <li>
              work with your neighbors!! and ask them to help you test things
              out
            </li>
            <li>alejandro and i are available if you get stuck</li>
          </ul>
        </section>
        <section>
          <h3>share with those around you</h3>
          <ul>
            <li>how does it make you feel?</li>
            <li>how does it feel when other people are there?</li>
            <li>what is getting you excited?</li>
          </ul>
        </section>
        <section>
          <h3>okay now let's turn that experience into a website</h3>
          <p>
            <strong>PROMPTS</strong>
          </p>
          <ul>
            <li>a participatory poster</li>
            <li>an event invitation</li>
            <li>a letter for a friend</li>
            <li>a yearbook</li>
            <li>a living room</li>
            <li>a kitchen</li>
            <li>a party</li>
            <li>a game</li>
            <li>a costume / character maker</li>
            <li>a band</li>
            <li>a bulletin board</li>
            <li>a community garden / farm</li>
            <li>a meditation room</li>
            <li>a collage</li>
            <li>a fireplace / campsite</li>
            <li>a friendship lamp</li>
          </ul>
        </section>
        <section>
          <h3>let's memorialize what we did here today!</h3>
          {/* TODO: hook up interactive sign up */}
          <em>
            sign the guestbook and if you'd like, leave a link to your website!
          </em>
          <br />
          <br />
          <Guestbook name={name || undefined} from={from || undefined} />
          <footer>
            a workshop by <a href="https://spencer.place/">spencer</a>
          </footer>
        </section>
      </div>
    </PlayProvider>
  );
}

interface GuestbookEntry {
  name?: string;
  from?: string;
  color?: string;
  message: string;
  timestamp: number;
}

const Guestbook = withSharedState(
  { defaultData: [] as GuestbookEntry[] },
  ({ data, setData }, { name, from }: { name?: string; from?: string }) => {
    const [message, setMessage] = React.useState("");

    const handleSubmit = () => {
      if (message.trim()) {
        setData([
          ...data,
          {
            name: name,
            from,
            color: window?.cursors?.color || undefined,
            message,
            timestamp: Date.now(),
          },
        ]);
        setMessage("");
      }
    };

    return (
      <div id="guestbook">
        <div
          className="guestbook-actions"
          style={{
            display: "flex",
            flexDirection: "column",
            marginBottom: "1em",
          }}
        >
          <span>
            <b
              style={{
                color: window?.cursors.color || "black",
              }}
            >
              {name || "Anonymous"}
            </b>
            {from ? ` (${from})` : ""} says...
          </span>
          <textarea
            maxLength={800}
            placeholder="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button type="submit" onClick={handleSubmit}>
            Send
          </button>
        </div>
        <hr />
        {data.map((entry, i) => (
          <div
            key={i}
            className="guestbook-entry"
            style={{
              display: "flex",
              flexDirection: "column",
              marginBottom: "1em",
              fontSize: "80%",
            }}
          >
            <div>
              <b
                style={{
                  color: entry.color || "black",
                }}
              >
                {entry.name || "Anonymous"}
              </b>{" "}
              {entry.from && `(from ${entry.from})`}
              <div
                style={{
                  float: "right",
                  fontSize: "50%",
                }}
              >
                {new Date(entry.timestamp).toLocaleString()}
              </div>
            </div>
            <div style={{}}>{entry.message}</div>
          </div>
        ))}
      </div>
    );
  }
);
ReactDOM.render(<Main />, document.getElementById("react"));
