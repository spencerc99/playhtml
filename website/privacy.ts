// ABOUTME: Boots the /privacy page: the shared site look and the header's live GitHub count.
// ABOUTME: The policy itself is static HTML in privacy.html.

import "./homepage.scss";
import "./pages.scss";
import { loadLiveCounts } from "./components/home/pageChrome";

loadLiveCounts();
