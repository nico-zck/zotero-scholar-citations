var Zotero = Components.classes["@zotero.org/Zotero;1"].getService(
  Components.interfaces.nsISupports
).wrappedJSObject;

function checkScholarUrl() {
  var boxUrl = document.getElementById("pref-zscc-scholar-url").value;
  if (boxUrl.length == 0) {
    Zotero.Prefs.set("extensions.zscc.scholarUrlVerified", false);
    Zotero.Prefs.set("extensions.zscc.scholarUrl", "");
  } else {
    try {
      if (boxUrl.startsWith("https://") && boxUrl.endsWith("/")) {
      } else {
        throw "Url should start with 'https:// and end with '/'";
      }

      testUrl = boxUrl + "schhp?hl=en";

      let xhr = new XMLHttpRequest();
      xhr.open("GET", testUrl, false);
      xhr.send();

      if (xhr.status == 200) {
        if (
          xhr.responseText.indexOf("Stand on the shoulders of giants") != -1
        ) {
          // a valid url
          alert("This site is valid and have been saved.");
          Zotero.Prefs.set("extensions.zscc.scholarUrlVerified", true);
          Zotero.Prefs.set("extensions.zscc.scholarUrl", boxUrl);
        } else {
          throw "This mirror site is not google scholar or not supports english language.";
        }
      } else {
        throw "Cannot open this url, plaease check your url!";
      }
    } catch (err) {
      // alert user
      alert(err);
      Zotero.Prefs.set("extensions.zscc.scholarUrlVerified", false);
      Zotero.Prefs.set("extensions.zscc.scholarUrl", "");
    }
  }
}
