// ABOUTME: Experiment 8 - Collaborative grid paper typing interface
// ABOUTME: Every grid cell is filled with typed letters, colored by user
import "./8.scss";
import React, { useEffect, useState, useRef, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider, withSharedState, usePlayContext } from "@playhtml/react";
import { OnlineNowIndicator } from "../../components/DataModes";
import profaneWords from "profane-words";

interface CellData {
  letter: string;
  color: string;
  timestamp: number;
}

const RestrictedWords = [...profaneWords];
const MAX_WORD_CHECK_LENGTH = 15; // Most profane words are shorter than this

const explicitSlurRegexes = [
  /\b[cĆćĈĉČčĊċÇçḈḉȻȼꞒꞓꟄꞔƇƈɕ][hĤĥȞȟḦḧḢḣḨḩḤḥḪḫH̱ẖĦħⱧⱨꞪɦꞕΗНн][iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ][nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ][kḰḱǨǩĶķḲḳḴḵƘƙⱩⱪᶄꝀꝁꝂꝃꝄꝅꞢꞣ][sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]?\b/,
  /\b[cĆćĈĉČčĊċÇçḈḉȻȼꞒꞓꟄꞔƇƈɕ][ÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏ0]{2}[nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ][sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]?\b/,
  /\b[fḞḟƑƒꞘꞙᵮᶂ][aÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ@4][gǴǵĞğĜĝǦǧĠġG̃g̃ĢģḠḡǤǥꞠꞡƓɠᶃꬶＧｇqꝖꝗꝘꝙɋʠ]{1,2}([ÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏ0e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅiÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ][tŤťṪṫŢţṬṭȚțṰṱṮṯŦŧȾⱦƬƭƮʈT̈ẗᵵƫȶ]{1,2}([rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ][yÝýỲỳŶŷY̊ẙŸÿỸỹẎẏȲȳỶỷỴỵɎɏƳƴỾỿ]|[rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ][iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ][e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ])?)?[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]?\b/,
  /\b[kḰḱǨǩĶķḲḳḴḵƘƙⱩⱪᶄꝀꝁꝂꝃꝄꝅꞢꞣ][iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌyÝýỲỳŶŷY̊ẙŸÿỸỹẎẏȲȳỶỷỴỵɎɏƳƴỾỿ][kḰḱǨǩĶķḲḳḴḵƘƙⱩⱪᶄꝀꝁꝂꝃꝄꝅꞢꞣ][e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]([rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ][yÝýỲỳŶŷY̊ẙŸÿỸỹẎẏȲȳỶỷỴỵɎɏƳƴỾỿ]|[rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ][iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ][e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ])?[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]*\b/,
  /\b[nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ][iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌoÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏІіa4ÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ][gǴǵĞğĜĝǦǧĠġG̃g̃ĢģḠḡǤǥꞠꞡƓɠᶃꬶＧｇqꝖꝗꝘꝙɋʠ]{2}(l[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]t|[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅaÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ][rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ]?|n[ÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏ0][gǴǵĞğĜĝǦǧĠġG̃g̃ĢģḠḡǤǥꞠꞡƓɠᶃꬶＧｇqꝖꝗꝘꝙɋʠ]|[a4ÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ]?)?[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]?\b/,
  /[nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ][iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌoÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏІіa4ÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ][gǴǵĞğĜĝǦǧĠġG̃g̃ĢģḠḡǤǥꞠꞡƓɠᶃꬶＧｇqꝖꝗꝘꝙɋʠ]{2}(l[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]t|[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ][rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ])[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]?/,
  /\b[tŤťṪṫŢţṬṭȚțṰṱṮṯŦŧȾⱦƬƭƮʈT̈ẗᵵƫȶ][rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ][aÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ4]+[nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ]{1,2}([iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ][e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]|[yÝýỲỳŶŷY̊ẙŸÿỸỹẎẏȲȳỶỷỴỵɎɏƳƴỾỿ]|[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ][rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ])[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]?\b/,
];

export const hasExplicitSlur = (handle: string): boolean => {
  return explicitSlurRegexes.some(
    (reg) =>
      reg.test(handle) ||
      reg.test(
        handle.replaceAll(".", "").replaceAll("-", "").replaceAll("_", "")
      )
  );
};

// Check if horizontal sequences containing the newest letter form profanity
function checkForProfanity(
  letters: CellData[],
  gridCols: number,
  newLetterIndex: number
): {
  hasProfanity: boolean;
  indicesToRemove: number[];
} {
  if (letters.length === 0) {
    return { hasProfanity: false, indicesToRemove: [] };
  }

  const indicesToRemove: number[] = [];

  // The newest letter is at the end of the array
  // Check the last MAX_WORD_CHECK_LENGTH letters (including the new one)
  // Reverse them because they display in reverse order (newest first)
  const startIdx = Math.max(0, letters.length - MAX_WORD_CHECK_LENGTH);
  const checkLetters = letters.slice(startIdx);
  const sequence = checkLetters
    .map((l) => l.letter)
    .reverse()
    .join("");

  // Check using explicit slur regexes - find the longest match
  let longestMatch: { start: number; length: number } | null = null;

  for (const regex of explicitSlurRegexes) {
    const match = sequence.match(regex);
    if (match && match.index !== undefined) {
      const matchLength = match[0].length;
      // Keep track of the longest match
      if (!longestMatch || matchLength > longestMatch.length) {
        longestMatch = { start: match.index, length: matchLength };
      }
    }
  }

  if (longestMatch) {
    // Mark all letters in the longest matched word for removal
    // Since we reversed the sequence, we need to map back to the original indices
    for (let i = 0; i < longestMatch.length; i++) {
      const reversedIdx = longestMatch.start + i;
      // Map back from reversed sequence to actual array index
      const letterArrayIdx = startIdx + (checkLetters.length - 1 - reversedIdx);
      if (letterArrayIdx >= 0 && letterArrayIdx < letters.length) {
        indicesToRemove.push(letterArrayIdx);
      }
    }
  }

  return {
    hasProfanity: indicesToRemove.length > 0,
    indicesToRemove,
  };
}

const Main = withSharedState(
  {
    defaultData: {
      letters: [] as CellData[],
    },
  },
  ({ data, setData, awareness }) => {
    const { cursors } = usePlayContext();
    const myColor = cursors.color;
    const gridRef = useRef<HTMLDivElement>(null);
    const [gridDimensions, setGridDimensions] = useState({
      cols: 60,
      rows: 40,
    });

    // Calculate grid dimensions based on window size
    useEffect(() => {
      const calculateDimensions = () => {
        // Use a fixed cell size for square aspect ratio
        // Get value from CSS variable (e.g., "32px" -> 32)
        const cellSizeValue = getComputedStyle(document.body)
          .getPropertyValue("--cell-size")
          .trim();

        const cellWidth = parseFloat(cellSizeValue) || 32; // Fallback to 32 if parsing fails
        const cellHeight = cellWidth; // Match width for square cells
        const cols = Math.floor(window.innerWidth / cellWidth);
        const rows = Math.floor(window.innerHeight / cellHeight);
        setGridDimensions({ cols, rows });
      };

      calculateDimensions();
      window.addEventListener("resize", calculateDimensions);
      return () => window.removeEventListener("resize", calculateDimensions);
    }, []);

    // Minimum cells to fill the page
    const minCells = gridDimensions.cols * gridDimensions.rows;

    // Total cells needed: always fill at least the screen
    const totalCells = minCells;

    // Cursor is always at position 0 (top-left)
    const cursorPosition = 0;

    // Process animation queue
    const processNextAnimation = React.useCallback(() => {
      if (isProcessingRef.current || animationQueueRef.current.length === 0) {
        return;
      }

      isProcessingRef.current = true;
      const nextItem = animationQueueRef.current.shift()!;

      setAnimatingLetter(nextItem);

      // Clear animation and add to data after animation completes
      setTimeout(() => {
        setData((draft) => {
          draft.letters.push({
            letter: nextItem.letter,
            color: nextItem.color,
            timestamp: Date.now(),
          });
        });
        setAnimatingLetter(null);
        isProcessingRef.current = false;

        // Process next item in queue
        setTimeout(() => {
          if (animationQueueRef.current.length > 0) {
            processNextAnimation();
          }
        }, 10);
      }, 150);
    }, [setData]);

    // Store processNextAnimation in a ref so it can be called from event handlers
    const processNextAnimationRef = useRef(processNextAnimation);
    useEffect(() => {
      processNextAnimationRef.current = processNextAnimation;
    }, [processNextAnimation]);

    // Handle keyboard input
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Ignore if user is typing in an input field
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement
        ) {
          return;
        }

        // Ignore if any modifier keys are pressed (cmd, ctrl, alt, meta)
        if (e.metaKey || e.ctrlKey || e.altKey) {
          return;
        }

        // Handle all printable characters, space, and special characters
        // Accept any single character key
        if (e.key.length === 1) {
          e.preventDefault();
          const char = e.key;

          // Add to queue
          animationQueueRef.current.push({ letter: char, color: myColor });

          // Start processing if not already running
          processNextAnimationRef.current();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [myColor]);

    // Get other users' cursor positions
    const otherCursors = Object.entries(awareness || {})
      .filter(([clientId]) => clientId !== "local")
      .map(([, data]) => data as { color: string; cursorPos: number });

    // Calculate character counts per player
    const characterCounts = useMemo(() => {
      const counts: Record<string, number> = {};
      data.letters.forEach((letter) => {
        counts[letter.color] = (counts[letter.color] || 0) + 1;
      });
      return counts;
    }, [data.letters]);

    const totalCharacters = data.letters.length;

    // Get all active players from cursor awareness
    const activePlayers = cursors.allColors.map((color, index) => ({
      color,
      isMe: color === myColor,
      count: characterCounts[color] || 0,
    }));

    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState(cursors.name || "");
    const inputRef = useRef<HTMLInputElement>(null);
    const [animatingLetter, setAnimatingLetter] = useState<{
      letter: string;
      color: string;
    } | null>(null);
    const animationQueueRef = useRef<Array<{ letter: string; color: string }>>(
      []
    );
    const isProcessingRef = useRef(false);
    const previousLetterCountRef = useRef(0);
    const lastCheckedTimestampRef = useRef<number>(0);

    const handleNameSubmit = () => {
      if (nameInput.trim()) {
        window.cursors.name = nameInput.trim();
      }
      setEditingName(false);
    };

    // Update input width to match content
    useEffect(() => {
      if (inputRef.current && editingName) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (context) {
          const styles = window.getComputedStyle(inputRef.current);
          context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
          const text = nameInput || cursors.name || "you";
          const width = context.measureText(text).width;
          // Add some padding for letter-spacing and safety
          inputRef.current.style.width = `${width + 20}px`;
        }
      }
    }, [nameInput, editingName, cursors.name]);

    // Check for profanity and auto-remove - only when new letters are added by this user
    useEffect(() => {
      // Only check if a new letter was added (not on initial load or deletions)
      if (data.letters.length <= previousLetterCountRef.current) {
        previousLetterCountRef.current = data.letters.length;
        return;
      }

      // The newest letter is at the end of the array
      const newLetterIndex = data.letters.length - 1;
      const newestLetter = data.letters[newLetterIndex];

      // Only check if this letter was added by the current user AND we haven't checked it yet
      if (
        newestLetter.color !== myColor ||
        newestLetter.timestamp <= lastCheckedTimestampRef.current
      ) {
        previousLetterCountRef.current = data.letters.length;
        return;
      }

      // Track this timestamp to avoid re-checking the same letter
      lastCheckedTimestampRef.current = newestLetter.timestamp;

      const { hasProfanity, indicesToRemove } = checkForProfanity(
        data.letters,
        gridDimensions.cols,
        newLetterIndex
      );

      if (hasProfanity) {
        // Show alert
        alert(
          "we don't seem to like that word :( please keep things nice here"
        );

        // Remove the offending letters
        setData((draft) => {
          // Sort indices in descending order to remove from end to start
          const sortedIndices = [...indicesToRemove].sort((a, b) => b - a);
          sortedIndices.forEach((idx) => {
            draft.letters.splice(idx, 1);
          });
        });
      }

      previousLetterCountRef.current = data.letters.length;
    }, [data.letters, gridDimensions.cols, setData, myColor]);

    return (
      <div id="experiment-8">
        <div
          ref={gridRef}
          className="grid-container"
          style={{
            gridTemplateColumns: `repeat(${gridDimensions.cols}, 32px)`,
          }}
        >
          {Array.from({ length: totalCells }, (_, index) => {
            const isCursorCell = index === cursorPosition;

            // Newest letters appear starting at index 1 (right of cursor)
            // They're in reverse order - newest first
            const letterIndex = index - 1;
            const letter =
              letterIndex >= 0 && letterIndex < data.letters.length
                ? data.letters[data.letters.length - 1 - letterIndex]
                : null;

            const isMyCursor = isCursorCell;
            const otherUserCursor = otherCursors.find(
              (c) => c.cursorPos === index
            );

            // Cursor cell should always be empty unless animating
            const displayContent = isCursorCell
              ? animatingLetter
                ? animatingLetter.letter
                : "\u00A0"
              : letter?.letter || "\u00A0";

            const displayColor =
              isCursorCell && animatingLetter
                ? animatingLetter.color
                : letter?.color || "transparent";

            return (
              <div
                key={index}
                className={`grid-cell ${isMyCursor ? "my-cursor" : ""} ${
                  otherUserCursor ? "other-cursor" : ""
                } ${letter ? "filled" : "empty"} ${
                  isCursorCell ? "cursor-cell" : ""
                } ${isCursorCell && animatingLetter ? "animating" : ""}`}
                style={{
                  color: displayColor,
                  borderColor: isMyCursor
                    ? myColor
                    : otherUserCursor
                    ? otherUserCursor.color
                    : undefined,
                }}
              >
                {displayContent}
              </div>
            );
          })}
        </div>

        <div className="bottom-bar">
          <div className="active-players">
            {activePlayers.map((player, index) => (
              <div
                key={index}
                className={`player-indicator ${player.isMe ? "me" : ""}`}
                style={{ backgroundColor: player.color }}
              >
                <div className="player-info">
                  {player.isMe ? (
                    editingName ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onBlur={handleNameSubmit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleNameSubmit();
                          } else if (e.key === "Escape") {
                            setNameInput(cursors.name || "");
                            setEditingName(false);
                          }
                        }}
                        autoFocus
                        className="name-input"
                      />
                    ) : (
                      <span onClick={() => setEditingName(true)}>
                        {cursors.name || "you"}
                      </span>
                    )
                  ) : (
                    <span>{"·"}</span>
                  )}
                  {player.count > 0 && (
                    <span className="player-count">{player.count}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="stats-container">
            <div className="total-characters">{totalCharacters}</div>
            <OnlineNowIndicator />
          </div>
        </div>
      </div>
    );
  }
);

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider
    initOptions={{
      cursors: {
        enabled: true,
      },
    }}
  >
    <Main />
  </PlayProvider>
);
