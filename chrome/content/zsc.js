function isDebug() {
  return (
    typeof Zotero != "undefined" &&
    typeof Zotero.Debug != "undefined" &&
    Zotero.Debug.enabled
  );
}

function getPref(pref) {
  return Zotero.Prefs.get("extensions.zscc." + pref);
}

//######################################################################
let zsc = {
  _captchaString: "",
  _citedPrefixString: "Cited by ",
  // _searchblackList: new RegExp('[-+~*":]', 'g'),
  // _baseUrl: "https://scholar.google.com/",
  _min_wait_time: 3000, // 3 seconds
  _max_wait_time: 5000, // 5 seconds

  _extraPrefix: "ZSCC:",
  _citeCountStrLength: 5,
  _noData: "NoData",
  _extraEntrySep: "\n",
};

zsc._extraRegex = new RegExp(zsc._extraPrefix + ".{0,20}");

zsc.init = function () {
  let stringBundle = document.getElementById("zoteroscholarcitations-bundle");
  if (stringBundle != null) {
    zsc._captchaString = stringBundle.getString("captchaString");
    zsc._citedPrefixString = stringBundle.getString("citedPrefixString");
  }

  // Temporarily disable Notifier to observe add event,
  //     as the request cannot use local cookie when adding new item.
  // Register the callback in Zotero as an item observer
  let notifierID = Zotero.Notifier.registerObserver(zsc.notifierCallback, [
    "item",
  ]);

  // Unregister callback when the window closes (important to avoid a memory leak)
  window.addEventListener(
    "unload",
    function (e) {
      Zotero.Notifier.unregisterObserver(notifierID);
    },
    false
  );
};

// so citation counts will be queried for >all< items that are added to zotero!? o.O
zsc.notifierCallback = {
  notify: function (event, type, ids, extraData) {
    if (event == "add") {
      zsc.processItems(Zotero.Items.get(ids));
    }
  },
};

zsc.hasRequiredFields = function (item) {
  return item.getField("title") && item.getCreators().length > 0;
};

zsc.updateCollectionMenuEntry = function () {
  if (!ZoteroPane.canEditLibrary()) {
    alert("You lack the permission to make edit to this library.");
    return;
  }

  let group = ZoteroPane.getSelectedGroup();
  if (group) {
    zsc.updateGroup(ZoteroPane.getSelectedGroup());
    return;
  }

  let collection = ZoteroPane.getSelectedCollection();
  if (collection) {
    zsc.updateCollection(collection);
    return;
  }

  alert("Updating citations for this type of Entry is not supported.");
  return;
};

zsc.updateItemMenuEntries = function () {
  if (!ZoteroPane.canEditLibrary()) {
    alert("You lack the permission to make edit to this library.");
    return;
  }
  zsc.processItems(ZoteroPane.getSelectedItems());
};

zsc.updateGroup = function (group) {
  alert("Updating a Group is not yet implemented.");
  return;
};

zsc.updateCollection = function (collection) {
  zsc.processItems(collection.getChildItems());
  let childColls = collection.getChildCollections();
  for (idx = 0; idx < childColls.length; ++idx) {
    zsc.updateCollection(childColls[idx]);
  }
};

zsc.processItems = function (items) {
  // get a random integer
  function randomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // try to add delay execution to get rid of reCAPTCHA
  let time = 0;
  while ((item = items.shift())) {
    if (!zsc.hasRequiredFields(item)) {
      if (isDebug())
        Zotero.debug(
          "[scholar-citations] skipping item '" +
            item.getField("title") +
            "' it has either an empty title or is missing creator information"
        );
      continue;
    }

    if (isDebug())
      Zotero.debug(
        "[scholar-citations] this retrieving will run in " +
          time +
          "milliseconds later."
      );
    // using setTimeout(non-blocking) to delay execution
    setTimeout(
      zsc.retrieveCitationData,
      time,
      item,
      function (item, citeCount) {
        if (isDebug())
          Zotero.debug(
            "[scholar-citations] Updating item '" + item.getField("title") + "'"
          );
        zsc.updateItem(item, citeCount);
      }
    );
    // cumulate time for next retrieve
    time += randomInteger(zsc._min_wait_time, zsc._max_wait_time);
  }
};

zsc.updateItem = function (item, citeCount) {
  let curExtra = item.getField("extra");

  if (isDebug())
    Zotero.debug("[scholar-citations] current extra field is: " + curExtra);

  let newExtra = zsc.buildCiteCountString(citeCount);
  if (zsc._extraRegex.test(curExtra)) {
    // if already have ZSCC string
    newExtra = curExtra.replace(zsc._extraRegex, newExtra);
    if (isDebug())
      Zotero.debug(
        "[scholar-citations] replace old ZSCC with new string " + newExtra
      );
  } else {
    // if not have ZSCC string
    newExtra = newExtra + zsc._extraEntrySep + curExtra;
    if (isDebug())
      Zotero.debug("[scholar-citations] add ZSCC to extra field " + newExtra);
  }

  item.setField("extra", newExtra);
  try {
    item.saveTx();
  } catch (e) {
    if (isDebug())
      Zotero.debug("[scholar-citations] could not update extra content: " + e);
  }
};

// TODO: complex version, i.e. batching + retrying + blocking for solved captchas
// this prob. involves some nasty callback hell shit
// TODO: retries with random author permutations decreasing in author number :^)
zsc.retrieveCitationData = function (item, cb) {
  let url = zsc.generateItemUrl(item);
  if (isDebug()) Zotero.debug("[scholar-citations] GET " + url);
  let citeCount;
  let xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);
  // xhr.responseType = "document";  // will return a HTMLDocument instead of text
  xhr.onreadystatechange = function () {
    if (this.readyState == 4 && this.status == 200) {
      // // debug on response text
      // if (isDebug()) Zotero.debug(this.responseText);

      // check if response includes meaningful content
      if (this.responseText.indexOf('class="gs_r gs_or gs_scl"') != -1) {
        if (isDebug()) {
          Zotero.debug(
            "[scholar-citations] received non-captcha scholar results!"
          );

          // check if the returned title match with the itme title
          var title1 = item
            .getField("title")
            .trim()
            .toLowerCase()
            .replace(/  +/g, " ");
          Zotero.debug("[scholar-citations] the item title: " + title1);
          var parser = new DOMParser();
          var htmlDoc = parser.parseFromString(this.responseText, "text/html");
          var title2 = htmlDoc
            .getElementsByClassName("gs_rt")[0]
            .innerText.trim()
            .toLowerCase()
            .replace(/  +/g, " ");
          Zotero.debug("[scholar-citations] the queried title: " + title2);
          Zotero.debug(
            "[scholar-citations] will item title equals to queried title?" +
              (title1 === title2)
          );
        }

        cb(item, zsc.getCiteCount(this.responseText));
      } else if (
        // check if response includes captcha
        this.responseText.indexOf("www.google.com/recaptcha/api.js") != -1
      ) {
        if (isDebug())
          Zotero.debug(
            "[scholar-citations] received a captcha instead of a scholar result"
          );
        alert(zsc._captchaString);
        if (typeof Zotero.openInViewer !== "undefined") {
          Zotero.openInViewer(url);
        } else if (typeof ZoteroStandalone !== "undefined") {
          ZoteroStandalone.openInViewer(url);
        } else if (typeof Zotero.launchURL !== "undefined") {
          Zotero.launchURL(url);
        } else {
          window.gBrowser.loadOneTab(url, { inBackground: false });
        }
      } else {
        // debug response text in other cases
        if (isDebug())
          Zotero.debug(
            "[scholar-citations] neither got meaningful text or captcha, please check the following response text"
          );
        if (isDebug()) Zotero.debug(this.responseText);
        alert("neither got meaningful text or captcha, please check it in log");
      }
    } else if (this.readyState == 4 && this.status == 429) {
      if (this.responseText.indexOf("www.google.com/recaptcha/api.js") == -1) {
        // failed without captcha
        if (isDebug())
          Zotero.debug(
            "[scholar-citations] could not retrieve the google scholar data. Server returned: [" +
              xhr.status +
              ": " +
              xhr.statusText +
              "]. " +
              "GS want's you to wait for " +
              this.getResponseHeader("Retry-After") +
              " seconds before sending further requests."
          );
      } else {
        // failed with captcha
        if (isDebug())
          Zotero.debug(
            "[scholar-citations] received a captcha instead of a scholar result"
          );
        alert(zsc._captchaString);
        if (typeof Zotero.openInViewer !== "undefined") {
          Zotero.openInViewer(url);
        } else if (typeof ZoteroStandalone !== "undefined") {
          ZoteroStandalone.openInViewer(url);
        } else if (typeof Zotero.launchURL !== "undefined") {
          Zotero.launchURL(url);
        } else {
          window.gBrowser.loadOneTab(url, { inBackground: false });
        }
      }
    } else if (this.readyState == 4) {
      if (isDebug())
        Zotero.debug(
          "[scholar-citations] could not retrieve the google scholar data. Server returned: [" +
            xhr.status +
            ": " +
            xhr.statusText +
            "]"
        );
    } else {
      // request progress, I guess
    }
  };
  xhr.send();
};

zsc.generateItemUrl = function (item) {
  let url =
    zsc.getBaseUrl() +
    "scholar?hl=en&as_q=" +
    // + zsc.cleanTitle(item.getField('title'))
    item.getField("title") +
    "&as_epq=&as_occt=title&num=1";

  let creators = item.getCreators();
  if (creators && creators.length > 0) {
    // using the first three authors is enough for accurate retrieval
    num_creators = creators.length > 3 ? 3 : creators.length;

    url += "&as_sauthors=";
    url += creators[0].lastName;
    for (let idx = 1; idx < num_creators; idx++) {
      url += "+" + creators[idx].lastName;
    }
  }

  let year = parseInt(item.getField("year"));
  if (year) {
    // set a small range of year instead of an exact number
    url += "&as_ylo=" + (year - 1) + "&as_yhi=" + (year + 1);
  }

  return encodeURI(url);
};

// zsc.cleanTitle = function(title) {
//     let clean_title = title.replace(zsc._searchblackList, ' ');
//     clean_title = clean_title.split(/\s/).join('+');
//     return clean_title;
// };

zsc.padLeftWithZeroes = function (numStr) {
  let output = "";
  let cnt = zsc._citeCountStrLength - numStr.length;
  for (let i = 0; i < cnt; i++) {
    output += "0";
  }
  output += numStr;
  return output;
};

zsc.buildCiteCountString = function (citeCount) {
  if (citeCount < 0) {
    countString = zsc._extraPrefix + zsc._noData;
  } else {
    countString =
      zsc._extraPrefix + zsc.padLeftWithZeroes(citeCount.toString());
  }
  return countString;
};

zsc.getCiteCount = function (responseText) {
  let citePrefix = ">" + zsc._citedPrefixString;
  let citePrefixLen = citePrefix.length;
  let citeCountStart = responseText.indexOf(citePrefix);

  if (citeCountStart === -1) {
    if (responseText.indexOf('class="gs_rt"') === -1) return -1;
    else return 0;
  } else {
    let citeCountEnd = responseText.indexOf("<", citeCountStart);
    let citeStr = responseText.substring(citeCountStart, citeCountEnd);
    let citeCount = citeStr.substring(citePrefixLen);
    return parseInt(citeCount.trim());
  }
};

zsc.openPreferenceWindow = function (paneID, action) {
  var io = { pane: paneID, action: action };
  window.openDialog(
    "chrome://zoteroscholarcitations/content/options.xul",
    "zotero-scholarcitations-options",
    "chrome,titlebar,toolbar,centerscreen" +
      Zotero.Prefs.get("browser.preferences.instantApply", true)
      ? "dialog=no"
      : "modal",
    io
  );
};

zsc.getBaseUrl = function () {
  defaultUrl = "https://scholar.google.com/";
  userUrl = getPref("scholarUrl");

  if (userUrl != null && userUrl.length > 0 && getPref("scholarUrlVerified")) {
    if (isDebug) {
      Zotero.debug(
        "[scholar-citations] will use a user specified base url: " + userUrl
      );
    }
    return userUrl;
  } else {
    if (isDebug) {
      Zotero.debug(
        "[scholar-citations] will use the default base url: " + defaultUrl
      );
    }
    return defaultUrl;
  }
};

if (typeof window !== "undefined") {
  window.addEventListener(
    "load",
    function (e) {
      zsc.init();
    },
    false
  );

  // API export for Zotero UI
  // Can't imagine those to not exist tbh
  if (!window.Zotero) window.Zotero = {};
  if (!window.Zotero.ScholarCitations) window.Zotero.ScholarCitations = {};
  // note sure about any of this
  window.Zotero.ScholarCitations.updateCollectionMenuEntry = function () {
    zsc.updateCollectionMenuEntry();
  };
  window.Zotero.ScholarCitations.updateItemMenuEntries = function () {
    zsc.updateItemMenuEntries();
  };
  window.Zotero.ScholarCitations.openPreferenceWindow = function () {
    zsc.openPreferenceWindow();
  };
}

if (typeof module !== "undefined") module.exports = zsc;
