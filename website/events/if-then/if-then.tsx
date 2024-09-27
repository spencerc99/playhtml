import ReactDOM from "react-dom";
import { PlayProvider } from "@playhtml/react";
import { useStickyState } from "../../hooks/useStickyState";
import { Cursors, PlayhtmlToolBox, Guestbook } from "../events";
import React from "react";

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
            <a href="https://playhtml.fun/events/if-then">
              https://playhtml.fun/events/if-then
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
          <br />
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
              <a href="https://playhtml.fun">playhtml homepage</a>
            </li>
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
              play with this{" "}
              <a href="https://honored-cubic-arthropod.glitch.me/">
                glitch template
              </a>{" "}
              and then click "Remix on Glitch" to get started
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
          </ul>{" "}
          <p>
            <strong>tips and tricks</strong>
          </p>
          <ul>
            <li>
              make sure each element has an ID! this makes it such that playhtml
              knows which element to associate the data with
            </li>
            <li>
              when using can-mirror, make sure things are working as expected
              first without playhtml and then add in the can-mirror attribute
            </li>
            <li>
              if things aren't working or you're stuck in a bad state, switch
              out IDs so that the data resets
            </li>
            <li>
              work with your neighbors!! and ask them to help you test things
              out
            </li>
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
          <p>
            <strong>tips and tricks</strong>
          </p>
          <ul>
            <li>
              make sure each element has an ID! this makes it such that playhtml
              knows which element to associate the data with
            </li>
            <li>
              when using can-mirror, make sure things are working as expected
              first without playhtml and then add in the can-mirror attribute
            </li>
            <li>
              if things aren't working or you're stuck in a bad state, switch
              out IDs so that the data resets
            </li>
            <li>
              work with your neighbors!! and ask them to help you test things
              out
            </li>
            <li>alejandro and i are available if you get stuck</li>
          </ul>
        </section>
        <section>
          <h3>break time! share with those around you</h3>
          <ul>
            <li>how does it make you feel?</li>
            <li>how does it feel when other people are there?</li>
            <li>what is getting you excited?</li>
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

ReactDOM.render(<Main />, document.getElementById("react"));
