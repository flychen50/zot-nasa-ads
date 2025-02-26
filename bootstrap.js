var ZotNasaAds;
var chromeHandle;

function log(msg) {
	Zotero.debug("zot-nasa-ads: " + msg);
}

function install() {
	log("Installed");
}

async function startup({ id, version, rootURI }) {
	log("Starting");
	
	// Load chrome/content file directly via file:/// URL
	Services.scriptloader.loadSubScript(rootURI + 'zot-nasa-ads.js');
    
    Zotero.PreferencePanes.register({
        pluginID: 'zot-nasa-ads@zot.nasa.ads',
        src: rootURI + 'chrome/content/prefs.xhtml',
    });
    ZotNasaAds.init({ id, version, rootURI });
    ZotNasaAds.addToAllWindows();
}

function onMainWindowLoad({ window }) {
    ZotNasaAds.addToWindow(window);
}

function onMainWindowUnload({ window }) {
    ZotNasaAds.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
    if (chromeHandle) {
        chromeHandle.destruct();
        chromeHandle = null;
    }
    ZotNasaAds.removeFromAllWindows();
    ZotNasaAds = undefined;
}

function uninstall() {
	log("Uninstalled");
}