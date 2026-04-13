// ABOUTME: Dev tools UI for playhtml — right sidebar with element inspector, data tree, and connection status.
// ABOUTME: Renders a RollerCoaster Tycoon-inspired toolbar with warm colors, beveled edges, and no rounded corners.

import type { PlayHTMLComponents } from "./index";
import { normalizePath } from "@playhtml/common";

// ─── Logo (base64 PNG, 48x48 — self-contained, no external deps) ─────
const LOGO_URI = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAeGVYSWZNTQAqAAAACAAEARoABQAAAAEAAAA+ARsABQAAAAEAAABGASgAAwAAAAEAAgAAh2kABAAAAAEAAABOAAAAAAAAAEgAAAABAAAASAAAAAEAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAMKADAAQAAAABAAAAMAAAAADouFg7AAAACXBIWXMAAAsTAAALEwEAmpwYAAAYFUlEQVRoBZ1aaZBdR3U+3X2Xd986b1bNSBptIysaSUhIXsrYYBmDbZCBIhXbbCH5kWIzlSrHhCRVFJKohMqPQDCEqsSBEEKFChYkpOIFgwwabMmLPJLtkcbSWJqRNNKMZp95y73vLt2dr++bsU0oXIQ3uu/u3d85/Z3vnO4nRr/jR2tiRJoOHjzIaD9RP51md9PdNDh4mA+izbLXg/vNz8b+bj1Ig3QN9ei91K8P0SEapm16P+3X5glmmmJo7Hf4vNbJb/Wu1sz0cpAOMgMYINhdgxNsuuRyr6+NzdASW5iss8nuybS5bnybo5V9P/WlIDsulPRQMqfdpVBds6dHz8CoYRpeNgjm/D+M+a0MWPE2sDB4jy0MLvDynklGl4vCW1Nhg3SEH6HTdAPtFHeeu7dQmvSKMiy4LNIOWTbFnoopFwdRabL2i01/v0R0LsnRHzKa6qJ1sVRX1yTKHQxVec+CuhsjQ3QAG4aYpf5KnfGbvt7UgCZw8+oBAO9nHdTBhs4NiQ25eXGpe5obKvxp7b7s1p9c21eY7bjBStzdWolezUSXErygOHnKEiQt3ZCClpSlZxKhxsJsdCosXj16dcsz517uOuT3z9xCXken2kj9STB4WI++wZAU4JuMyG80QIMuTasPsiNEvBPb6CRZyr4kHm1/if/RsU+0bzq+fV+mkb1TaeutmrOCEsySnOGUSRyrWMCPFiNpXGlxkpyEsrhQgmLcryW2PJl41f+a33DqFy9t+uupDXSb9iY71Vh9Tu643Cb37iVFiJM3G4k3MeAAPHwadCnztXu288nZy85I+xi/fnZz9h3fv3NfdqHwCUaiH4CFtACIM60MWLNxYgCJY44BWT5//ZgkrsEQ0oLDYEqkpU4nxcWHRlcfeqK47lStOLNbUwclIzQhJ6lHmmD/TUb8mgErnj9E93CMgFhzeY0YzZbsx1oPiy//x+e2dp7u/nMrcd4NYBwg0TnXALQMGPvUAABMDQD4piEAy3QCw7QNozjXCZ5DG1rjvmLcwrGM7egJv/PMV872f+mVvvnrqaV1Q3x5uCKpv1+aID9gYuP/0Amvv/4xnIcqsgEaEB3rOwWG05pfrZ2z3qjzhQc/fVfXue6v2IlzLcFr2BRxgGCa4xjf2Bs34ducg//pFTLeFuk5gxFmS89BUGM0njNtEIwyOOx+K+i8pW3hlsmljU+MiQWHs14bnc3QZ+g0XrmHjhw4YmTwtU/6Wnq2rOv79/ez/k7iHpE1203OSRp17n/wIx9pn2r5GjD3EiURIT6gD9g0RwNmD9cb32BPRmoBa3lsISfmKH1cGQNTI82I4RhPvW4IRoLrkDGxzq2t/kb74Bc/Vi2/YCWLi85GYDk0vE0Y6U51GH2sWGCtHGB4oDT3sI1U5l65By+SM9ty3vn8Nz/0kcKct5+4dAE1MR1yIJFNrEAGSwwq05ARP4PYtI9rqU9Sk3APlxhoLzkMXDYTBqSmpvFjxk/gZtoHy9hR+4Hyi19jk7u+/O/jiy3k9RMFw9vo0Om0DyBoIk9HwPC+/xACFuAnJ3vsxCPn+ZbT9se/e/udxXn3APEko0WsNI9BDzCZQ1eUhiHoT6JjpcEXyJTBiZFotm1gNoGnV3ACSTEeZKCd8b6hTkq5lHxmNCgloqEkGmeuHXd+sXv483dVWp4SCZHjlclauLvMDx06xFdiNY0BdoDx/m2dvI0KlozJnixP2B/86Q39q8+VvyoUtcF7Ev2bztFts6OU6Ib+6FiASBKwEIxNYLhmuG0CNAWKgDXcT9VHpHJqAng5HmC2BVtxjtfTZk0vqdGcu0IWdjn+xufnW385QzMZ1ltuVbltM/q7NEBHDh6BxfD+fiSpoXNzYnTWs2tO6LZP54q9Z0sPQCs2KBFJEjE6SyCY2PPICCfokMDZCXu1Mc2eTa5YdfBKYCQESGTBtY6JYUMl/DOflFXGKOBNA9moFYIYRsIny39GAGAHM8Zgw0iAqWJ9trb9gfzSxhJlfacy69szcGQaD8AujPcLZAkrhCB6ifti4YJz74/f8v7Con0fhjRZadowt3ls+jB0ZvzFeJqP1CZYezZD7uZ2np8lVbEkGxVVflFXRJRlLMccaL5RHqBJRwFSYDfPzTWjUhhGYxhGABamo2BGA/dMj3icMXtTJlp7IVn3xHCYZMmbz6jewk79z/SIFnv3kuhe324tJYGT2NrdfaajZ/PZ4kHwuwtOhFTCnaat1JNGR4xXDVtRqKFY2Co2ad9eRayTWOusVCfYrFWItepkWcVWCeRmS4NPOrGBxBiyvMkV8GYEABr0QZtofIVKqWE4x3UYIzjLro11+CR3p/3JRST48hVZojHN79p7DavBB5bFrfFcRWw9U7zV0kk/WXFKHdCGmIjwRMSYlaCTEJ3EpO2YZplknzp3wb7//CvOI5VEHHaLogopOkFdYkB3WFP1PEQJ4QccMBkxYjzfjAUTH3AMAMITuGZyBIIJfTXP8Y4xxtwDbbVEh9tytbe/N6RXWUcHt8SUaxnRsYYuRKKrSFYgE3tTVCiWKvIDUBsHrYcQPagklFYbzyutlZEYCzKimQ92XV3y2WI1oMSRND7F2WnvBjtayKNqmwVoi8pyNf1xjxX1utIAR1kBJQIosxlvN8ECsKEPrjGO9G6hP1OWyATAcQPsgnjgg6dl6x2u2v2jsBEuzdj5eC2FnEfuepQECPaOHN/2SmazUHIXPByTMB6H54XxOHJXum/gOEBnIYVezJbqDYhbhrlegZS/REvT50i3byHbQcpIGjR67gwNLOWETDnepI+JA0q9DGTL6kOoixjYlqDqfun4z8Wrw4OC2XAUjIQRK7ERc3J2Zus391G+KhyLrPHJUPBrukGORmhfpMDqmKYbOY9z0Hx0YhQnBtiIeGoMDLFCSB42EfB5HvCh6bNsce4iLc1NICHZNDc+Rg7q/5nZNpqfEzRzOaTnzi+IMcqiDjXFHTyfFnHwfgo6pQucwpnlOnRu5GX++A+/LV56/gjKPHDHPGPiIt2Mell5O15/Qy2Y5LhlWXaLsBYXIUEF3yqDZF4cbcdlDCDSkxk0UweDpNXIxJ6gjLBgFJDAW4tRTJ/b3iPFNRYtKIuGihl+yp9HVbZEhbY1tHglogC2XrykaGiXa3WWw0gikOFtiAoi0/DdqA6QmDgIk5CdPHZYWLZLO2+6TflBnTmeB+fhPgLI0IgjmBWVdpVzLQ6Xvmy1ssjd9VAkLMv7LjttlpTriBkPp7RBR6H13Py8/svnzoh/PDPGcQ5qN0g7ocYfK2SIetttvaM7q3e1OnpdXuilqcvUucoi7hYpX3SpuhjSi+MxX7TcJnDUZwQDmA0umQ0GCddmZ15+jk9cfJVt3nmdTlBufe+rX7Ce/M9/FXESNZ/DK7ADg+GsFbUdrX4jEVrMCCtTKvAai3i2KouCRe3IiqYsM0ppHZ8M1TdOzoggUXRXX0mTHQioslIiQyNXKuyx8Ssin3GolC9Saf0WymWXaPLqFLX21sjN5iib47S4ENL5sRq7cG2b1d/akKCaycAYyXRwIX+C6n6FBp/6qXDcDO259U7l5fIoJTidGPgpjxGOt3/0T5TtZKAhCqpid3LqKDl8bDrDiijMg0g0KBFujLTDI+hRiPQWiuNTNfX1E9M8lJo++daSfk+fw7UINLMDVtc1um6V0F+6qazue0tB7esVyuUx3drV0Lzhk6xdpVzJIzeXJxsxMzNZo7MzyN9OhoOHqHIQvR6CNCNIZB0aPnGUT10ao2v23KjXbOmn9rXr2fs/+WeyY3WvPv3sAP/Z97/Fo7ixoloFrnOejdDWQSJ40vDTVAXXOozHGSgOPzMf6K+/sMhjVF+fvDarbt8M7ouGwgiAw3W+hBphPIjYOOq1uquZVwQjXJv2rFmg9YVAT1++TB3tKCpEjnI5onoloOHhClviHud5pGEPxHdgBKizVJnnLz59mHv5Au2+7U6MMubQyB2rNmxi7/v0A7pjzTp96pkBfuzRHwrQTSMxZqAErp+JuMjZEGsvSxgBjgk3LIT6IIJ9mWg/1lR0GfWWET5OYAIaqciEkqSqamEjExM0Nh1zxm2tnTyVOmtsTdclvXt1nn1vuECr+uYpWypSsOCQng5pdGSRzk918Y4eV2u0jZaYgOa//OhhNjdxhXa/6z26a+MmpB7kHASuqZdaOjsp31ImMzpxiPgz8YzbRgesCuMV9A4dsJgXgfg2SnwrCiGqetcaRffuZHqxoenvnm7wM3OhJjfgZPuo0hq05NfZJ24O6L531OgzN8/Qx3dfobUlTCBK8/zdO16lDNVpZmyE2jpyoFGRMpmI5q7W6NixJVYx88+cYCJrs5mr4+zkz59gpY4OunbfB0BPKBwGh0NSg0adHnnoQT46dJJt2nUt3fj79yKCQXkIlqKGSoDbKCVsMl8Jq2HKqkTsmwTGrZDfszthH96t9HRN01cHFBueiTRzkMiciCaqMQ1cctmxKzkanM2zkVqJFUooaopF2rDRpuv66nR5dJxsPUeFjlVUKNkko4BOPnWFjr9QJ+YgGaIUOfGzx1htYZ627b2N2tat5qgXUqUK6lX2+D99nY8cf4Y27tpD+z5zvyq0tpn5BPKJrMXMjzwzm8imBoDX+FQ8UZdOMktomKwIdXGk77m2QR+9PtKTFUY/OAnVsHyK0I3gPnS7QpPVhEamOT1/waZq4hJlyzCiTO+7qQHKxTQ2+EvKZxrUuWk9uW5Cs1cW6AcPjbKBX4R6cXFGXx4+Qa09q2nXHbeDGWAVwoJDZi+cfonOPnuUNu25jvZ99n7tlUqoLVFXYoQUk/OaL9ZDFOzkg4c/qv9Nt/SDYj3Lin9w/NTf5mX0TpKQHsN3M0nBi2PIqp6rqadN0Vw9T7NBibasN/UOQDs2XZxspwvBFrpl6yjOSyTdFnrgH1ro8LOoSCxNnX07idw19OrJK1SZrlCx1aXr37Wa3v72ht642dItnWtQZxgyIH8gUQY1n82Nj1M7VCiTzzEtm+WQBekJw9nDV4K/+Kus2151hVWxMvVYBy4padtJzbOG8/XqO0mY2t8YYBIHo02ICYQcNosW4zw9ctKho+e7zCwCABlVEB7bt+EZB5JjeSRyGfrUhyx6/lRC1XpC4y89RS1dq2kPqHJiYJQWJmbpyYfnafLSRvaxz/ZSucvH1MRGusUkCRVfJufo3u1bAcoELaZcSNqGJZgvgezzI5imyBilZQjs4mNfvNFLlLJlRJkssuuq6sIdqAyNK0AwUxmazQZ4bDa8vdBOXYUKbepR1AWFai8RLdY59axuo55V6MH2oCBZ6lidwwJXoo8+U0eRaZNfmaYc6LRu21a6+MorwFCjq2OXKYzyrG9HgQpFFL943ThNowpWCmU4Rt/UESl8U9VoFTX00W9pmp6AtxqYpoeWgzWQQAuZs6UcK3de3DI9dSbL5M50SE0tiw0IYERzm0U87NqUp2IBBmEENHdoJoAaI0dBPnANlaiAdALJLW/L6ClMEH7833Ns5opmY0Mv061bt8OI66gyP0UyrtHE+SkaPdtD3d3wqQliU/Ux8A4hawxBozACAgjHxPHicBAPXpQ2JktxKCnbkFZVulLKGIlAyqVsrjpfKD2V9asgLQwGaIRVEzzASnJp6NUFOnISIeTgHu4HUNj+vjKtXrca4JtGGWNRB5IfJrT3vXm564MZ+ctH5q2xUwFT1af5Te/4PS0yiBXZQvX5aeZPnsTkd4PJM8YImI6QhiFQexiC/lF3SBnoSJ4/nCTTVUu2oRDKJJWKray6gq8lVv1QR2e1r4Y6ugc6x6P3A18vWmyCN96HAUkiaN/NHq1ZVYCX4W2Uzob/tdBC6QD1MiOQUs7Mxom8IukIFWgRVe8dH1+FAiiXVC4mPNs6hXDJA1qG/EWbNeaxXMMwAiZLGc8b8IY62EwAcNRPUlXOV+XR55hdALlQ6wuFNao6llXjmswmdqJzPEQOi6fzhenJQumH6xr1+03FZTzRpI9FbsaiLZsQEyYeLMgYPJ5twd5GWSrMcyZeDAWMAUoXOywIiKII8yvjV8zqqLjew9zSBCx2AJtt9XSutUVLiUU5hqye0gh3TUAYITHzSrzYkK/8qB6cm/bsVsyyVCSryFuWK7kM8jLjoZRL4hjq2UAgxy92rTriW5kXCDOrlOeGGiaQzd6AN0AR569t6QTXgG8aAO1K/YgZaPppikjKacQhZIUS2JPABGyYhSkFTGbuTKaUMSOBOTfDdewxA+CxnH6u0njyaS9TxLK8CA3WJKsSg53vWD8hRZyTeVdGKhEh6NTwmaqcai3/m2QWEptjipbUkBTgyvHKfsXr8LwJeDyY+jDVD0MJONEYYCihEUXIcNhjvmuOAdpM+psTfxhjjjHXNsZh6o/ZpOKJqk/Vo2PfU8yvCGCDOoV5Nxs1yjLZsb5b8lF6l3KCugwSKy4K1UD0Ba7i4ZlS7sxoPvcvmlvIRk2v43jZy2/cr1CsGdRGftG7kW8AAc5UVyAFIGOT02ZhADex0GAKQ0z+8KAxIjUOzxu2IXMxiewbRY1k6NuBHBoRPBvGBlschUESxPLCrBylsuJ3Y919ZG5CliKZ+KGOMLcJIEr1bCTD4y35gYuu8x0AT0zAokgCqBXwrwNvUgreNyOALfV+6nucAma6GToDZgra6LtZ5Vg2wni8SSFDowTvS6Ehmo1o5Du16OhRUjkUaHYNU/jAbY8bDWDdsd5JfzNAj/u1+aVQVnsT36vFodANVKQBklDdUio42pb5n0sZC0ZgfRWJ7PVgNcaYgDWGoJnl4DVwUwNSsE3MZlFvJQ5S76f0WTbCjMLySKR7LLogFqI4Hv3Okn/kMcEdH+/UgDnIR7oxO58k7dUwQT5X5pcbVApMDyCsx5dOKcffEIc+FkdZyYdXa6jNa65iwdESe/Sswx6MGZ9FVdYEbLxtQK8AB1WM900qMkLYNAIGmMvYgdzYmRFYMc/sscaaFgiGUul1S+vGTCN59Zvz9WM/cWzPl1LUsAxbb7GVrxwndHwrxk+6cvjgNjRo/tK2TeMH2UM0IbypotPa1eYszi/kMIfMu7YuJHFSih07syEUW7Yn3oeLwt1jKAX0yDGgFjJvM4lhHRRy2kAhUEcQBth88BmTTF2H8phiAVMudIp3sWAG2cQeFRqqKmgxxLbxYtA4/3AQXjrLAZ4nooLArjaYrDl+1m+ARf1dm6M9NImAOWB8ZYA3P2gax4f44+euWqLvkrVUybsi8bP4EStvWzyPZY8ilswxg3VKO5T3trW8sM/lzrpUas1CqYkPGKK4AHDM6MBxAzxYNqABsYRB6BHZNV3RMg7AvBKVIybrl5Nk8fEgHD0mo2iJW3YdSxNVeKaGHyBqmOgEOT9unAV1VvVdTe6mhyFvRt9M/frax9iitdd3UAaEpZUQ1MPiXODlDMUVqk44F6oWK/WsqPzsvA6H+qi0Z1VCN2WF1weptU2MwBSUv9gMi5ramVa0aN3QFSRKRx6YVahVcFYrfzCKpp6Lw8oMt52G7WZqUsl64opaEks/C/DlghsGU7VkB6gzQG1pAyuwXxsBcwGdsoN0gN2CzgL8XjBb6LUy3oTrRnYm1DyL5bAsKtUsxTKfcO2Z6akjeanHLq7pEcXtBTu/3mJ2Z8x1CYuRmQbWQKDLUAUZ+pT4GI35ROpZmURjMvbPKl27HMVB1eIZhBcL0F4d65B1JKrAZRk/dDBdD6ejbR2d0SE6gqDdi0DZD+o0vW8w/4oB5oIJNo14OAIjhs61ig198yK5sOjwbNZNHJZxpPKU0B5STRbx54HCuCSdiKFQUsIpca/oMTuLFTWUpEZ/EdKMQVYakHFdlypGfYriHUJv2Zj2aRYiOTcsZvkxlAYTesh4FNp2rlENa3GmKx93HCG1d+9+kzgQN6+DN+dvoJA5Bf70e78eOHhQ9e9fpbvplBq1ctrtTFDbtiTKX4xZ7IRIqCYrZljCXYiPm8XUDGnfDmVcxQPNXxYkijR8UAxjrQlBACpaKB1Bt1jFEng5BlaG3FaNmtRh3lONnCyEkbLjWstSnBkuSerqlwMDw/rWW38VeAoTX78+Ait3sDeUOkQP8434zx1DbZMil5u2Kq7rrOUlqxb5jp11bJQrThwoF1Niy0owHlh0RZJCBYYS2PAdH+RoPIb5FNBicdMsKMTCQkWJVJsESYz/wBCxOBsFmQZ+667EHXU/GUGiKkPr3xiwb4D22uH/At4IJ6pN/ZoEAAAAAElFTkSuQmCC";

// ─── SVG Icons (inline, no dependencies) ───────────────────────────────
const ICONS = {
  inspect: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
  minimize: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>`,
};

// ─── Badge colors per tag type ─────────────────────────────────────────
const BADGE_COLORS: Record<string, string> = {
  "can-move": "#4a9a8a",
  "can-spin": "#5b8db8",
  "can-toggle": "#c4724e",
  "can-grow": "#d4b85c",
  "can-duplicate": "#8a6abf",
  "can-mirror": "#4a9a8a",
  "can-play": "#3d3833",
  "can-hover": "#5b8db8",
};
const BADGE_FALLBACK = "#8a8279";

// ─── CSS (injected once into the document) ─────────────────────────────
const DEV_STYLES = `
#playhtml-dev-root {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 100000;
  font-family: 'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 12px;
  line-height: 1.4;
  color: #3d3833;
  pointer-events: none;
}
#playhtml-dev-root * {
  box-sizing: border-box;
}
.ph-trigger {
  pointer-events: auto;
  position: fixed;
  bottom: 16px;
  right: 0;
  width: 120px;
  height: 48px;
  background: linear-gradient(135deg, #f0e9dd 0%, #e8e0d4 40%, #d8d0c4 100%);
  border: 3px solid;
  border-color: #f5f0e8 #7a7269 #6b6560 #ede6da;
  border-right: none;
  padding: 4px 6px;
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  z-index: 100000;
  box-shadow: -2px 0 4px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08), 0 -2px 6px rgba(0,0,0,0.1);
}
.ph-trigger:hover {
  background: linear-gradient(135deg, #f8f2e8 0%, #f0e9dd 40%, #e0d8cc 100%);
  box-shadow: -2px 0 6px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.12), 0 -3px 8px rgba(0,0,0,0.14);
}
.ph-trigger img {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  filter: drop-shadow(0 0 4px #5b8db8);
}
.ph-trigger-grip {
  display: flex;
  flex-direction: row;
  gap: 3px;
  align-items: center;
  flex: 1;
  justify-content: center;
}
.ph-trigger-grip span {
  display: block;
  width: 2px;
  height: 16px;
  background: linear-gradient(180deg, #f5f0e8 0%, #8a8279 50%, #6b6560 100%);
}
.ph-bar {
  pointer-events: auto;
  display: none;
  flex-direction: row;
  background: #e8e0d4;
  border-left: 3px solid #3d3833;
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 400px;
}
.ph-bar.ph-open {
  display: flex;
}
.ph-bar-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.ph-bar-main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ph-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: linear-gradient(180deg, #ede6da 0%, #d4cfc7 100%);
  border-bottom: 1px solid #8a8279;
  flex-shrink: 0;
}
.ph-toolbar .ph-logo-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}
.ph-toolbar .ph-logo-btn img {
  width: 22px;
  height: 22px;
  filter: drop-shadow(0 0 4px #5b8db8);
}
.ph-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  cursor: pointer;
  color: #3d3833;
  padding: 0;
}
.ph-btn:hover {
  background: #f5f0e8;
}
.ph-btn.ph-active {
  border-color: #8a8279 #f5f0e8 #f5f0e8 #8a8279;
  background: #d4cfc7;
}
.ph-btn svg {
  width: 16px;
  height: 16px;
}
.ph-data {
  flex: 1;
  padding: 6px 10px;
  overflow-y: auto;
  background: #f5f0e8;
  font-size: 12px;
}
.ph-data::-webkit-scrollbar {
  width: 4px;
}
.ph-data::-webkit-scrollbar-thumb {
  background: #d4cfc7;
}
.ph-reset-btn {
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #c4724e;
  cursor: pointer;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  padding: 2px 8px;
}
.ph-reset-btn:hover {
  background: #f5f0e8;
}
.ph-reset-btn:active {
  border-color: #8a8279 #f5f0e8 #f5f0e8 #8a8279;
  background: #d4cfc7;
}
.ph-tree-item {
  padding: 3px 0 3px 14px;
  border-left: 1px solid #d4cfc7;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ph-tree-item:hover {
  background: #faf7f2;
}
.ph-tree-toggle {
  color: #8a8279;
  font-size: 10px;
  width: 10px;
  flex-shrink: 0;
  text-align: center;
  user-select: none;
}
.ph-tree-key {
  color: #4a9a8a;
}
.ph-tree-value {
  color: #c4724e;
}
.ph-tree-badge {
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 9px;
  padding: 1px 5px;
  font-weight: 700;
  text-transform: uppercase;
  color: #faf7f2;
  letter-spacing: 0.3px;
  flex-shrink: 0;
}
.ph-tree-el-name {
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 12px;
}
.ph-tree-reset {
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 10px;
  color: #c4724e;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
  background: none;
  border: none;
  padding: 0;
  margin-left: 4px;
}
.ph-tree-item:hover > .ph-tree-reset {
  opacity: 1;
}
.ph-tree-children {
  display: none;
  margin-left: 14px;
  padding-left: 6px;
  border-left: 1px solid #d4cfc7;
}
.ph-tree-children.ph-expanded {
  display: block;
}
.ph-tree-child {
  padding: 2px 0 2px 28px;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 11px;
  border-left: 1px solid #d4cfc7;
  margin-left: 14px;
}
.ph-resize-handle {
  width: 6px;
  cursor: ew-resize;
  background: #d4cfc7;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-right: 1px solid #8a8279;
}
.ph-resize-handle::after {
  content: '';
  width: 2px;
  height: 40px;
  background: #8a8279;
  opacity: 0.5;
}
.ph-status {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 10px;
  background: #d4cfc7;
  border-bottom: 1px solid #8a8279;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 11px;
  color: #6b6560;
  flex-shrink: 0;
}
.ph-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ph-status .ph-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ph-status .ph-dot.ph-connected {
  background: #4a9a8a;
}
.ph-status .ph-dot.ph-disconnected {
  background: #c4724e;
}
.ph-status .ph-sep {
  color: #b0a99e;
}
.ph-minimize-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 20px;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  cursor: pointer;
  color: #3d3833;
  padding: 0;
  margin-left: auto;
}
.ph-minimize-btn:hover {
  background: #f5f0e8;
}
.ph-minimize-btn:active {
  border-color: #8a8279 #f5f0e8 #f5f0e8 #8a8279;
  background: #d4cfc7;
}
.ph-minimize-btn svg {
  width: 12px;
  height: 12px;
}
.ph-status-field {
  position: relative;
  border: 1px solid #8a8279;
  padding: 2px 8px 2px 8px;
  margin: -2px 0;
  display: inline-flex;
  align-items: center;
}
.ph-status-field-label {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  background: #d4cfc7;
  padding: 0 4px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 700;
  color: #4a9a8a;
  line-height: 1;
  white-space: nowrap;
}
.ph-json-string { color: #c4724e; }
.ph-json-number { color: #5b8db8; }
.ph-json-boolean { color: #d4b85c; }
.ph-json-null { color: #8a8279; font-style: italic; }
.ph-json-bracket { color: #8a8279; }
.ph-json-count { color: #8a8279; font-size: 10px; margin: 0 2px; }
.ph-json-row {
  padding: 2px 0 2px 4px;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 11px;
}
.ph-json-expandable {
  cursor: pointer;
  user-select: none;
}
.ph-json-expandable:hover {
  background: #faf7f2;
}
.ph-json-toggle {
  color: #8a8279;
  font-size: 8px;
  margin-right: 4px;
  display: inline-block;
  width: 10px;
}
.ph-json-nested {
  display: block;
  margin-left: 14px;
  padding-left: 6px;
  border-left: 1px solid #d4cfc7;
}
.ph-json-nested.ph-collapsed {
  display: none;
}
.ph-search-bar {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
}
.ph-search-input {
  width: 180px;
  padding: 3px 8px;
  font-family: 'Martian Mono', 'SF Mono', monospace;
  font-size: 11px;
  color: #3d3833;
  background: #faf7f2;
  border: 2px solid;
  border-color: #8a8279 #f5f0e8 #f5f0e8 #8a8279;
  outline: none;
}
.ph-search-input::placeholder {
  color: #b0a99e;
}
.ph-search-input:focus {
  border-color: #4a9a8a #d4cfc7 #d4cfc7 #4a9a8a;
}
.ph-tag-filter {
  padding: 3px 6px;
  font-family: 'Atkinson Hyperlegible', sans-serif;
  font-size: 11px;
  color: #3d3833;
  background: #e8e0d4;
  border: 2px solid;
  border-color: #f5f0e8 #8a8279 #8a8279 #f5f0e8;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  padding-right: 18px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238a8279'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 5px center;
}
.ph-tag-filter:hover {
  background-color: #f5f0e8;
}
.ph-empty {
  text-align: center;
  padding: 20px;
  color: #8a8279;
  font-size: 12px;
  font-family: 'Atkinson Hyperlegible', sans-serif;
}
.ph-inspect-highlight {
  outline: 2px dashed #4a9a8a;
  outline-offset: 2px;
  position: relative;
}
.ph-inspect-highlight-hover {
  outline-color: #c4724e;
  box-shadow: 0 0 0 4px rgba(196, 114, 78, 0.15);
}
.ph-inspect-selected {
  outline: 2px solid #c4724e;
  outline-offset: 2px;
}
.ph-inspect-label {
  position: absolute;
  top: -18px;
  left: 0;
  background: #4a9a8a;
  color: #faf7f2;
  font-family: 'Martian Mono', monospace;
  font-size: 10px;
  padding: 2px 8px;
  pointer-events: none;
  z-index: 99999;
  white-space: nowrap;
}
@keyframes ph-flash {
  0% { outline: 3px solid #d4b85c; outline-offset: 2px; }
  100% { outline: 3px solid transparent; outline-offset: 2px; }
}
.ph-flash {
  animation: ph-flash 0.8s ease-out;
}
`;

// ─── Shared Elements Listing ───────────────────────────────────────────
export function listSharedElements() {
  const out: Array<{
    type: "source" | "consumer";
    elementId: string;
    dataSource: string;
    normalized: string;
    permissions?: "read-only" | "read-write";
    element: HTMLElement;
  }> = [];

  document.querySelectorAll("[shared]").forEach((el) => {
    const element = el as HTMLElement;
    const id = element.id;
    if (!id) return;
    const ds = `${window.location.host}${normalizePath(
      window.location.pathname
    )}#${id}`;
    out.push({
      type: "source",
      elementId: id,
      dataSource: ds,
      normalized: ds,
      permissions: element.getAttribute("shared")?.includes("read-only")
        ? "read-only"
        : "read-write",
      element,
    });
  });

  document.querySelectorAll("[data-source]").forEach((el) => {
    const element = el as HTMLElement;
    const raw = element.getAttribute("data-source") || "";
    const [domainAndPath, elementId] = raw.split("#");
    if (!domainAndPath || !elementId) return;
    const firstSlash = domainAndPath.indexOf("/");
    const domain =
      firstSlash === -1 ? domainAndPath : domainAndPath.slice(0, firstSlash);
    const path = firstSlash === -1 ? "/" : domainAndPath.slice(firstSlash);
    const normalized = `${domain}${normalizePath(path)}#${elementId}`;
    out.push({
      type: "consumer",
      elementId,
      dataSource: raw,
      normalized,
      element,
    });
  });

  try {
    console.table(
      out.map((e) => ({
        type: e.type,
        elementId: e.elementId,
        dataSource: e.dataSource,
        normalized: e.normalized,
        permissions: e.permissions || "",
      }))
    );
  } catch {}
  return out;
}

// ─── Helper: create element with classes ───────────────────────────────
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes?: string,
  attrs?: Record<string, string>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classes) e.className = classes;
  if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}

// ─── Main Setup ────────────────────────────────────────────────────────
export function setupDevUI(playhtml: PlayHTMLComponents) {
  // Guard against duplicate setup (e.g. HMR)
  const existing = document.getElementById("playhtml-dev-root");
  if (existing) existing.remove();

  const { elementHandlers } = playhtml;

  // Inject styles
  const styleEl = document.createElement("style");
  styleEl.textContent = DEV_STYLES;
  document.head.appendChild(styleEl);

  // ── State ──
  let inspectMode = false;
  let selectedElementId: string | null = null;
  let hoveredElement: HTMLElement | null = null;
  const inspectLabels: HTMLElement[] = [];

  // ── Root ──
  const root = el("div");
  root.id = "playhtml-dev-root";

  // ── Trigger tab ──
  const trigger = el("div", "ph-trigger");
  const triggerImg = el("img", undefined, {
    src: LOGO_URI,
    alt: "playhtml",
  });
  trigger.appendChild(triggerImg);

  // Grip lines below logo
  const grip = el("div", "ph-trigger-grip");
  for (let i = 0; i < 4; i++) {
    grip.appendChild(document.createElement("span"));
  }
  trigger.appendChild(grip);

  // ── Sidebar bar ──
  const bar = el("div", "ph-bar");

  // Resize handle on left edge of sidebar
  const resizeHandle = el("div", "ph-resize-handle");

  // Content wrapper (vertical column)
  const barContent = el("div", "ph-bar-content");

  // Toolbar (horizontal header row)
  const toolbar = el("div", "ph-toolbar");

  // Logo
  const logoBtn = el("div", "ph-logo-btn");
  const logoImg = el("img", undefined, {
    src: LOGO_URI,
    alt: "playhtml",
  });
  logoBtn.appendChild(logoImg);
  toolbar.appendChild(logoBtn);

  // Inspect button
  const inspectBtn = el("button", "ph-btn");
  inspectBtn.innerHTML = ICONS.inspect;
  inspectBtn.title = "Inspect";
  inspectBtn.style.width = "26px";
  inspectBtn.style.height = "22px";
  toolbar.appendChild(inspectBtn);

  // Spacer pushes minimize to right
  const toolbarSpacer = el("div");
  toolbarSpacer.style.flex = "1";
  toolbar.appendChild(toolbarSpacer);

  // Minimize button (top right)
  const minimizeBtn = el("button", "ph-minimize-btn");
  minimizeBtn.innerHTML = ICONS.minimize;
  minimizeBtn.title = "Minimize";
  toolbar.appendChild(minimizeBtn);

  barContent.appendChild(toolbar);

  // ── Status line (two rows) ──
  const status = el("div", "ph-status");

  // Row 1: connection + counts
  const statusRow1 = el("div", "ph-status-row");
  const dot = el("span", "ph-dot ph-connected");
  statusRow1.appendChild(dot);
  statusRow1.appendChild(document.createTextNode("connected"));
  const sepClients = el("span", "ph-sep");
  sepClients.textContent = "\u00B7";
  statusRow1.appendChild(sepClients);
  const clientCountNode = document.createTextNode("");
  statusRow1.appendChild(clientCountNode);
  const sep1 = el("span", "ph-sep");
  sep1.textContent = "\u00B7";
  statusRow1.appendChild(sep1);
  const elCountNode = document.createTextNode("");
  statusRow1.appendChild(elCountNode);
  status.appendChild(statusRow1);

  // Row 2: room + host
  const statusRow2 = el("div", "ph-status-row");
  let decodedRoom: string;
  try {
    decodedRoom = decodeURIComponent(playhtml.roomId);
  } catch {
    decodedRoom = playhtml.roomId;
  }
  const roomField = el("span", "ph-status-field");
  const roomFieldLabel = el("span", "ph-status-field-label");
  roomFieldLabel.textContent = "room";
  roomField.appendChild(roomFieldLabel);
  roomField.appendChild(document.createTextNode(decodedRoom));
  statusRow2.appendChild(roomField);

  const sep2 = el("span", "ph-sep");
  sep2.textContent = "\u00B7";
  statusRow2.appendChild(sep2);

  const hostField = el("span", "ph-status-field");
  const hostFieldLabel = el("span", "ph-status-field-label");
  hostFieldLabel.textContent = "host";
  hostField.appendChild(hostFieldLabel);
  hostField.appendChild(document.createTextNode(playhtml.host));
  statusRow2.appendChild(hostField);
  status.appendChild(statusRow2);

  function updateStatusCounts() {
    let clients = 1;
    try {
      const provider = playhtml.cursorClient?.getProvider();
      if (provider) {
        clients = provider.awareness.getStates().size;
      }
    } catch {}
    clientCountNode.textContent = `${clients} client${clients !== 1 ? "s" : ""}`;

    let total = 0;
    elementHandlers.forEach((idMap) => {
      total += idMap.size;
    });
    elCountNode.textContent = `${total} element${total !== 1 ? "s" : ""}`;
  }
  updateStatusCounts();

  barContent.appendChild(status);

  // Data area (takes remaining space)
  const barMain = el("div", "ph-bar-main");
  const dataArea = el("div", "ph-data");
  barMain.appendChild(dataArea);
  barContent.appendChild(barMain);
  bar.appendChild(resizeHandle);
  bar.appendChild(barContent);

  // ── Assemble root ──
  root.appendChild(trigger);
  root.appendChild(bar);
  document.body.appendChild(root);

  // ── JSON tree renderer ──
  function renderJsonValue(container: HTMLElement, value: unknown, depth: number, key?: string) {
    if (value === null) {
      const row = el("div", "ph-json-row");
      if (key !== undefined) {
        const k = el("span", "ph-tree-key");
        k.textContent = key + ": ";
        row.appendChild(k);
      }
      const v = el("span", "ph-json-null");
      v.textContent = "null";
      row.appendChild(v);
      container.appendChild(row);
      return;
    }

    if (value === undefined) {
      const row = el("div", "ph-json-row");
      if (key !== undefined) {
        const k = el("span", "ph-tree-key");
        k.textContent = key + ": ";
        row.appendChild(k);
      }
      const v = el("span", "ph-json-null");
      v.textContent = "undefined";
      row.appendChild(v);
      container.appendChild(row);
      return;
    }

    if (typeof value === "string") {
      const row = el("div", "ph-json-row");
      if (key !== undefined) {
        const k = el("span", "ph-tree-key");
        k.textContent = key + ": ";
        row.appendChild(k);
      }
      const v = el("span", "ph-json-string");
      v.textContent = value.length > 80 ? `"${value.substring(0, 80)}..."` : `"${value}"`;
      if (value.length > 80) v.title = value;
      row.appendChild(v);
      container.appendChild(row);
      return;
    }

    if (typeof value === "number") {
      const row = el("div", "ph-json-row");
      if (key !== undefined) {
        const k = el("span", "ph-tree-key");
        k.textContent = key + ": ";
        row.appendChild(k);
      }
      const v = el("span", "ph-json-number");
      v.textContent = String(value);
      row.appendChild(v);
      container.appendChild(row);
      return;
    }

    if (typeof value === "boolean") {
      const row = el("div", "ph-json-row");
      if (key !== undefined) {
        const k = el("span", "ph-tree-key");
        k.textContent = key + ": ";
        row.appendChild(k);
      }
      const v = el("span", "ph-json-boolean");
      v.textContent = String(value);
      row.appendChild(v);
      container.appendChild(row);
      return;
    }

    if (Array.isArray(value)) {
      const row = el("div", "ph-json-row ph-json-expandable");
      const toggle = el("span", "ph-json-toggle");
      const nested = el("div", "ph-json-nested");
      const shouldAutoExpand = value.length <= 5 && depth <= 2;

      toggle.textContent = shouldAutoExpand ? "\u25BC" : "\u25B6";
      if (!shouldAutoExpand) nested.classList.add("ph-collapsed");

      if (key !== undefined) {
        const k = el("span", "ph-tree-key");
        k.textContent = key + ": ";
        row.appendChild(k);
      }
      row.appendChild(toggle);
      const bracket = el("span", "ph-json-bracket");
      bracket.textContent = "[";
      row.appendChild(bracket);
      const count = el("span", "ph-json-count");
      count.textContent = String(value.length);
      row.appendChild(count);
      const bracketClose = el("span", "ph-json-bracket");
      bracketClose.textContent = "]";
      row.appendChild(bracketClose);

      row.onclick = (e) => {
        e.stopPropagation();
        const collapsed = nested.classList.toggle("ph-collapsed");
        toggle.textContent = collapsed ? "\u25B6" : "\u25BC";
      };

      for (let i = 0; i < value.length; i++) {
        renderJsonValue(nested, value[i], depth + 1, String(i));
      }

      container.appendChild(row);
      container.appendChild(nested);
      return;
    }

    if (typeof value === "object") {
      const keys = Object.keys(value as Record<string, unknown>);
      const row = el("div", "ph-json-row ph-json-expandable");
      const toggle = el("span", "ph-json-toggle");
      const nested = el("div", "ph-json-nested");
      const shouldAutoExpand = keys.length <= 5 && depth <= 2;

      toggle.textContent = shouldAutoExpand ? "\u25BC" : "\u25B6";
      if (!shouldAutoExpand) nested.classList.add("ph-collapsed");

      if (key !== undefined) {
        const k = el("span", "ph-tree-key");
        k.textContent = key + ": ";
        row.appendChild(k);
      }
      row.appendChild(toggle);
      const bracket = el("span", "ph-json-bracket");
      bracket.textContent = "{";
      row.appendChild(bracket);
      const count = el("span", "ph-json-count");
      count.textContent = String(keys.length);
      row.appendChild(count);
      const bracketClose = el("span", "ph-json-bracket");
      bracketClose.textContent = "}";
      row.appendChild(bracketClose);

      row.onclick = (e) => {
        e.stopPropagation();
        const collapsed = nested.classList.toggle("ph-collapsed");
        toggle.textContent = collapsed ? "\u25B6" : "\u25BC";
      };

      for (const k of keys) {
        renderJsonValue(nested, (value as Record<string, unknown>)[k], depth + 1, k);
      }

      container.appendChild(row);
      container.appendChild(nested);
      return;
    }

    // Fallback for anything else
    const row = el("div", "ph-json-row");
    if (key !== undefined) {
      const k = el("span", "ph-tree-key");
      k.textContent = key + ": ";
      row.appendChild(k);
    }
    row.appendChild(document.createTextNode(String(value)));
    container.appendChild(row);
  }

  function renderJsonTree(container: HTMLElement, data: unknown, depth: number) {
    if (data === null || data === undefined) {
      const v = el("span", "ph-json-null");
      v.textContent = String(data);
      container.appendChild(v);
    } else if (typeof data === "object" && !Array.isArray(data)) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        renderJsonValue(container, value, depth, key);
      }
    } else {
      renderJsonValue(container, data, depth);
    }
  }

  // ── Render data tree view ──
  let searchQuery = "";
  let tagFilter = "";

  function renderDataWalker() {
    dataArea.innerHTML = "";

    // Search + filter + actions bar (single row)
    const searchBar = el("div", "ph-search-bar");

    const searchInput = el("input", "ph-search-input");
    searchInput.type = "text";
    searchInput.placeholder = "Search by element ID...";
    searchInput.value = searchQuery;
    let searchTimeout: ReturnType<typeof setTimeout>;
    searchInput.oninput = () => {
      searchQuery = searchInput.value;
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => renderDataWalker(), 150);
    };
    searchBar.appendChild(searchInput);

    // Collect all tag types for the filter dropdown
    const tagTypes = new Set<string>();
    elementHandlers.forEach((_idMap, tagType) => tagTypes.add(tagType));

    if (tagTypes.size > 1) {
      const filterSelect = el("select", "ph-tag-filter");
      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "All types";
      filterSelect.appendChild(allOption);
      tagTypes.forEach((tt) => {
        const opt = document.createElement("option");
        opt.value = tt;
        opt.textContent = tt;
        filterSelect.appendChild(opt);
      });
      filterSelect.value = tagFilter;
      filterSelect.onchange = () => {
        tagFilter = filterSelect.value;
        renderDataWalker();
      };
      searchBar.appendChild(filterSelect);
    }

    const resetAllBtn = el("button", "ph-reset-btn");
    resetAllBtn.textContent = "Reset All";
    resetAllBtn.onclick = () => {
      if (!window.confirm("Reset all playhtml element data?")) return;
      elementHandlers.forEach((idMap) => {
        idMap.forEach((handler) => {
          handler.setData(handler.defaultData);
        });
      });
      renderDataWalker();
    };
    searchBar.appendChild(resetAllBtn);

    dataArea.appendChild(searchBar);

    // Restore focus to search input after re-render
    requestAnimationFrame(() => {
      if (searchQuery) {
        searchInput.focus();
        searchInput.setSelectionRange(searchQuery.length, searchQuery.length);
      }
    });

    // Check if there are any elements
    let hasElements = false;
    elementHandlers.forEach((idMap) => {
      if (idMap.size > 0) hasElements = true;
    });

    if (!hasElements) {
      const empty = el("div", "ph-empty");
      empty.textContent = "No playhtml elements found.";
      dataArea.appendChild(empty);
    } else {
      // Build tree for each tag type and element
      let matchCount = 0;
      elementHandlers.forEach((idMap, tagType) => {
        // Apply tag filter
        if (tagFilter && tagType !== tagFilter) return;

        idMap.forEach((handler, elementId) => {
          // Apply search filter
          if (searchQuery && !elementId.toLowerCase().includes(searchQuery.toLowerCase())) return;
          matchCount++;
          const row = el("div", "ph-tree-item");
          row.setAttribute("data-element-id", elementId);
          row.setAttribute("data-tag-type", tagType);

          // Toggle triangle
          const toggle = el("span", "ph-tree-toggle");
          toggle.textContent = "\u25B6";

          // Badge
          const badge = el("span", "ph-tree-badge");
          badge.textContent = tagType;
          badge.style.background = BADGE_COLORS[tagType] || BADGE_FALLBACK;

          // Element name
          const elName = el("span", "ph-tree-el-name");
          elName.textContent = `#${elementId}`;

          // Per-element reset (restore to default data)
          const resetBtn = el("button", "ph-tree-reset");
          resetBtn.textContent = "reset";
          resetBtn.onclick = (e) => {
            e.stopPropagation();
            handler.setData(handler.defaultData);
            renderDataWalker();
          };

          // Highlight element on page when hovering tree row
          row.onmouseenter = () => {
            const target = document.getElementById(elementId);
            if (target) {
              target.classList.add("ph-inspect-highlight", "ph-inspect-highlight-hover");
            }
          };
          row.onmouseleave = () => {
            const target = document.getElementById(elementId);
            if (target) {
              target.classList.remove("ph-inspect-highlight", "ph-inspect-highlight-hover");
            }
          };

          row.appendChild(toggle);
          row.appendChild(badge);
          row.appendChild(elName);
          row.appendChild(resetBtn);

          // Children container (recursive JSON tree)
          // TODO: make values editable inline (click to edit, enter to save back to store)
          // TODO: add per-key reset and per-nested-level reset (not just per-element)
          const children = el("div", "ph-tree-children");
          renderJsonTree(children, handler.data, 0);

          // Toggle expand/collapse
          function toggleExpand() {
            const expanded = children.classList.toggle("ph-expanded");
            toggle.textContent = expanded ? "\u25BC" : "\u25B6";
          }
          // Triangle click: just toggle expand/collapse
          toggle.onclick = (e) => {
            e.stopPropagation();
            toggleExpand();
          };
          // Row click: scroll to element + highlight + expand data
          row.onclick = (e) => {
            const clickTarget = e.target as HTMLElement;
            // Let triangle and reset handle their own clicks
            if (clickTarget.closest(".ph-tree-toggle") || clickTarget.closest(".ph-tree-reset")) return;
            // Scroll to element and flash
            const domTarget = document.getElementById(elementId);
            if (domTarget) {
              domTarget.scrollIntoView({ behavior: "smooth", block: "center" });
              domTarget.classList.add("ph-flash");
              domTarget.addEventListener(
                "animationend",
                () => domTarget.classList.remove("ph-flash"),
                { once: true }
              );
            }
            // Expand data if not already
            if (!children.classList.contains("ph-expanded")) {
              toggleExpand();
            }
          };

          dataArea.appendChild(row);
          dataArea.appendChild(children);
        });
      });

      if (matchCount === 0 && (searchQuery || tagFilter)) {
        const noMatch = el("div", "ph-empty");
        noMatch.textContent = "No elements match the current filter.";
        dataArea.appendChild(noMatch);
      }
    }

    // Shared elements section
    const shared = listSharedElements();
    if (shared.length > 0) {
      const dividerEl = document.createElement("hr");
      dividerEl.style.border = "none";
      dividerEl.style.borderTop = "1px solid #d4cfc7";
      dividerEl.style.margin = "6px 0";
      dataArea.appendChild(dividerEl);

      const sharedHeader = el("div", "ph-data-header");
      sharedHeader.textContent = "Shared Elements";
      sharedHeader.style.fontSize = "10px";
      dataArea.appendChild(sharedHeader);

      for (const entry of shared) {
        const row = el("div", "ph-tree-item");

        const badge = el("span", "ph-tree-badge");
        if (entry.type === "source") {
          badge.textContent = "SRC";
          badge.style.background = "#4a9a8a";
        } else {
          badge.textContent = "REF";
          badge.style.background = "#5b8db8";
        }

        const elName = el("span", "ph-tree-el-name");
        elName.textContent = `#${entry.elementId}`;
        elName.title = entry.dataSource;
        elName.onclick = (e) => {
          e.stopPropagation();
          entry.element.scrollIntoView({ behavior: "smooth", block: "center" });
          entry.element.classList.add("ph-flash");
          entry.element.addEventListener(
            "animationend",
            () => entry.element.classList.remove("ph-flash"),
            { once: true }
          );
        };

        row.appendChild(badge);
        row.appendChild(elName);
        dataArea.appendChild(row);
      }
    }
  }

  // ── Sidebar width state ──
  let sidebarWidth = 400;
  const originalBodyMarginRight = document.body.style.marginRight;

  // ── Open / Close ──
  function open() {
    trigger.style.display = "none";
    bar.classList.add("ph-open");
    document.body.style.marginRight = `${sidebarWidth}px`;
    updateStatusCounts();
    renderDataWalker();
  }

  function close() {
    trigger.style.display = "";
    bar.classList.remove("ph-open");
    document.body.style.marginRight = originalBodyMarginRight;
    // Exit inspect mode if active
    if (inspectMode) {
      inspectMode = false;
      inspectBtn.classList.remove("ph-active");
      deactivateInspect();
    }
  }

  // ── Auto-refresh when new playhtml elements appear ──
  let lastElementCount = 0;
  elementHandlers.forEach((idMap) => { lastElementCount += idMap.size; });

  const elementObserver = new MutationObserver((mutations) => {
    // Ignore mutations from the dev tools UI itself
    for (const m of mutations) {
      if (root.contains(m.target)) return;
    }
    let currentCount = 0;
    elementHandlers.forEach((idMap) => { currentCount += idMap.size; });
    if (currentCount !== lastElementCount) {
      lastElementCount = currentCount;
      if (bar.classList.contains("ph-open")) {
        updateStatusCounts();
        renderDataWalker();
      }
    }
  });
  // Only watch childList — class changes on existing elements won't add new playhtml elements
  elementObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ── Trigger click to open ──
  trigger.addEventListener("click", () => open());

  minimizeBtn.onclick = () => close();

  // ── Resize handle drag behavior ──
  resizeHandle.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();

    const onMove = (ev: MouseEvent) => {
      sidebarWidth = Math.max(280, Math.min(700, window.innerWidth - ev.clientX));
      bar.style.width = `${sidebarWidth}px`;
      document.body.style.marginRight = `${sidebarWidth}px`;
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  // ── Helpers: find tag type and handler for an element ID ──
  function lookupHandler(elementId: string): { tagType: string; handler: any } | null {
    let result: { tagType: string; handler: any } | null = null;
    elementHandlers.forEach((idMap, tagType) => {
      if (idMap.has(elementId)) {
        result = { tagType, handler: idMap.get(elementId) };
      }
    });
    return result;
  }

  // ── Scroll tree to a specific element row and expand it ──
  function scrollTreeToElement(elementId: string) {
    const row = dataArea.querySelector(
      `.ph-tree-item[data-element-id="${elementId}"]`
    ) as HTMLElement | null;
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "nearest" });
    // Expand the children container that follows this row
    const children = row.nextElementSibling;
    if (children && children.classList.contains("ph-tree-children")) {
      children.classList.add("ph-expanded");
      const toggle = row.querySelector(".ph-tree-toggle");
      if (toggle) toggle.textContent = "\u25BC";
    }
  }

  // ── Inspect mode: activate / deactivate ──
  function activateInspect() {
    const elements = document.querySelectorAll("[class*='__playhtml-']");
    elements.forEach((domEl) => {
      const htmlEl = domEl as HTMLElement;
      htmlEl.classList.add("ph-inspect-highlight");
      // Inject ID label
      const elId = htmlEl.id;
      if (elId) {
        const label = el("div", "ph-inspect-label");
        label.textContent = `#${elId}`;
        htmlEl.appendChild(label);
        inspectLabels.push(label);
      }
    });
  }

  function deactivateInspect() {
    // Remove highlight classes from all elements
    document
      .querySelectorAll(
        ".ph-inspect-highlight, .ph-inspect-highlight-hover, .ph-inspect-selected"
      )
      .forEach((domEl) => {
        domEl.classList.remove(
          "ph-inspect-highlight",
          "ph-inspect-highlight-hover",
          "ph-inspect-selected"
        );
      });
    // Remove injected labels
    for (const label of inspectLabels) {
      label.remove();
    }
    inspectLabels.length = 0;
    hoveredElement = null;
  }

  // ── Inspect button toggle ──
  inspectBtn.onclick = () => {
    inspectMode = !inspectMode;
    inspectBtn.classList.toggle("ph-active", inspectMode);
    if (inspectMode) {
      activateInspect();
    } else {
      deactivateInspect();
    }
  };

  // TODO: Rework inspect mode into a focused detail view for a single element
  // (like Chrome DevTools element inspector). Clicking an element on the page
  // should open a detailed panel showing: synced data, awareness state,
  // capability config, and live-updating preview. The current inspect mode
  // just duplicates what the tree row hover already does.

  // ── Mousemove handler: hover highlight on page elements ──
  document.addEventListener("mousemove", (event) => {
    if (!inspectMode) return;

    const target = (event.target as HTMLElement).closest(
      "[class*='__playhtml-']"
    ) as HTMLElement | null;

    if (target && target !== hoveredElement) {
      if (hoveredElement) {
        hoveredElement.classList.remove("ph-inspect-highlight-hover");
      }
      hoveredElement = target;
      target.classList.add("ph-inspect-highlight-hover");
    } else if (!target) {
      if (hoveredElement) {
        hoveredElement.classList.remove("ph-inspect-highlight-hover");
        hoveredElement = null;
      }
    }
  });

  // ── Click handler (capture): select element in inspect mode ──
  document.addEventListener(
    "click",
    (event) => {
      if (!inspectMode) return;

      // Let dev UI clicks through
      const devRoot = document.getElementById("playhtml-dev-root");
      if (devRoot && devRoot.contains(event.target as Node)) return;

      const target = (event.target as HTMLElement).closest(
        "[class*='__playhtml-']"
      ) as HTMLElement | null;

      if (target) {
        event.preventDefault();
        event.stopPropagation();

        // Remove previous selection
        document
          .querySelectorAll(".ph-inspect-selected")
          .forEach((domEl) => domEl.classList.remove("ph-inspect-selected"));

        // Apply selection
        target.classList.add("ph-inspect-selected");
        const elId = target.id;
        selectedElementId = elId || null;

        // Log handler data
        const info = elId ? lookupHandler(elId) : null;
        if (info) {
          console.log(
            `[playhtml inspect] ${info.tagType} #${selectedElementId}`,
            info.handler.data
          );
        }

        // Auto-scroll tree
        if (elId) {
          scrollTreeToElement(elId);
        }
      }
    },
    true
  );
}
