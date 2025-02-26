ZotNasaAds = {
    id: null,
	version: null,
	rootURI: null,
	initialized: false,
	addedElementIDs: [],

    log(msg) {
		Zotero.debug("zot-nasa-ads: " + msg);
	},

    init({ id, version, rootURI }) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.initialized = true;

        this.log("Initialized");
        this.log(Zotero.Prefs.get('extensions.zotero.zot-nasa-ads.api-key', true))
	},

    addToWindow(window) {
        let doc = window.document;

        // Add separator before our menu items
        let separatorBefore = doc.createXULElement("menuseparator");
        separatorBefore.id = 'zot-nasa-ads-separator-before';
        doc.getElementById('zotero-itemmenu').appendChild(separatorBefore);
        this.storeAddedElement(separatorBefore);

        // Add menu option for updating metadata
        let updateMenuItem = doc.createXULElement("menuitem");
        updateMenuItem.id = 'zot-nasa-ads-update-metadata-menu';
        updateMenuItem.setAttribute('label', 'Update Metadata from NASA ADS');
        doc.getElementById('zotero-itemmenu').appendChild(updateMenuItem);
        updateMenuItem.addEventListener('command', () => {
            this.updateMetadataFromNasaAds();
        });
        this.storeAddedElement(updateMenuItem);

        // Add menu option for downloading PDF
        let pdfMenuItem = doc.createXULElement("menuitem");
        pdfMenuItem.id = 'zot-nasa-ads-download-pdf-menu';
        pdfMenuItem.setAttribute('label', 'Download Publisher PDF from NASA ADS');
        doc.getElementById('zotero-itemmenu').appendChild(pdfMenuItem);
        pdfMenuItem.addEventListener('command', () => {
            this.updatePdfFromNasaAds();
        });
        this.storeAddedElement(pdfMenuItem);

        // Add separator after our menu items
        let separatorAfter = doc.createXULElement("menuseparator");
        separatorAfter.id = 'zot-nasa-ads-separator-after';
        doc.getElementById('zotero-itemmenu').appendChild(separatorAfter);
        this.storeAddedElement(separatorAfter);
    },

    addToAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.addToWindow(win);
        }
    },

    storeAddedElement(elem) {
        if (!elem.id) {
            throw new Error("Element must have an id");
        }
        this.addedElementIDs.push(elem.id);
    },

    removeFromWindow(window) {
        var doc = window.document;
        // Remove all elements added to DOM
        for (let id of this.addedElementIDs) {
            doc.getElementById(id)?.remove();
        }
    },

    removeFromAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (!win.ZoteroPane) continue;
            this.removeFromWindow(win);
        }
    },

    async updateMetadataFromNasaAds() {
        // Get the selected item in Zotero.
        let selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
        if (selectedItems.length < 1) {
            Zotero.alert(null, "Zot-NASA-ADS", "Please select at least one item.");
            return;
        }

        // get API key
        let apiKey = Zotero.Prefs.get('extensions.zot-nasa-ads.api-key', true);

        for (let item of selectedItems) {
            let queryValue = this.getItemIdentifier(item);
            if (!queryValue) {
                Zotero.alert(null, "Zot-NASA-ADS", "No valid identifier found for item: " + item.getField('title'));
                continue;
            }
            let nasaAdsApiUrl = `https://api.adsabs.harvard.edu/v1/search/query?q=${queryValue}&fl=title,author,doi,bibcode,abstract,bibstem,volume,issue,page,pub,issn,pubdate,property,identifier,arxiv_class,doctype&rows=1`;

            // Make the HTTP request to the NASA ADS API.
            try {
                let response = await Zotero.HTTP.request("GET", nasaAdsApiUrl, {
                    headers: {
                        "Authorization": "Bearer " + apiKey,
                    }
                });

                if (response.status !== 200) {
                    Zotero.alert(null, "Zot-NASA-ADS", "Failed to fetch data from NASA ADS.");
                    continue;
                }

                // Parse the response and update the item's metadata.
                let data = JSON.parse(response.responseText);
                if (data.response.docs.length === 0) {
                    Zotero.alert(null, "Zot-NASA-ADS", "No results found for the DOI.");
                    continue;
                }

                let adsData = data.response.docs[0];
                this.log(JSON.stringify(adsData))

                // Check that there is a non-arXiv result.
                if (adsData.doctype === 'eprint') {
                    Zotero.alert(null, "Zot-NASA-ADS", "No non-arXiv result found for the DOI.");
                    continue;
                }

                // Change the item type to journal article if it's currently a preprint.
                if (item.itemTypeID === Zotero.ItemTypes.getID('preprint') &&
                        adsData.doctype === 'article') {
                    item.setType(Zotero.ItemTypes.getID('journalArticle'));
                    await item.saveTx();
                }

                // Update fields with the data from NASA ADS.
                item.setCreators(adsData.author.map(name => {
                    let [lastName, firstName] = name.split(", ");
                    return { lastName, firstName, creatorType: "author" };
                }));
                if (adsData.abstract) item.setField('abstractNote', adsData.abstract);
                if (adsData.pub) item.setField('publicationTitle', adsData.pub);
                if (adsData.bibstem) item.setField('journalAbbreviation', adsData.bibstem[0])
                if (adsData.volume) item.setField('volume', adsData.volume);
                if (adsData.issue) item.setField('issue', adsData.issue);
                if (adsData.pages) item.setField('pages', adsData.page[0]);

                // Strip the day from the date if it's not available.
                if (adsData.pubdate) {
                    let formattedPubDate = adsData.pubdate;
                    if (formattedPubDate.endsWith("-00")) {
                        formattedPubDate = formattedPubDate.substring(0, formattedPubDate.length - 3);
                    }
                    item.setField('date', formattedPubDate);
                }
                if (adsData.issn) item.setField('ISSN', adsData.issn[0]);
                if (adsData.doi) item.setField('DOI', adsData.doi[0]);
                if (adsData.doi) item.setField('url', `https://doi.org/${adsData.doi[0]}`);

                // Update the Extra field with additional information, preserving existing data.
                let extraLines = item.getField('extra').split('\n');
                let extraUpdateFields = ['ADS Bibcode', 'tex.archivePrefix', 'tex.eprint', 'tex.primaryClass', 'tex.adsurl', 'tex.adsnote'];
                let newExtraLines = extraLines.filter(line => !extraUpdateFields.some(field => line.startsWith(field)));
                newExtraLines.push(`ADS Bibcode: ${adsData.bibcode}`);
                if (adsData.property.includes('EPRINT_OPENACCESS')) {
                    let arxivId = adsData.identifier.find(id => id.startsWith('arXiv:'));
                    if (arxivId) {
                        newExtraLines.push(`tex.archivePrefix: arXiv`);
                        newExtraLines.push(`tex.eprint: ${arxivId.replace('arXiv:', '')}`);
                    }
                    if (adsData.arxiv_class) newExtraLines.push(`tex.primaryClass: ${adsData.arxiv_class[0]}`);
                }
                newExtraLines.push(`tex.adsurl: https://ui.adsabs.harvard.edu/abs/${adsData.bibcode}`);
                newExtraLines.push(`tex.adsnote: Provided by the SAO/NASA Astrophysics Data System`);
                item.setField('extra', newExtraLines.join('\n'));

                await item.saveTx();

                Zotero.alert(null, "Zot-NASA-ADS", "Metadata updated from NASA ADS.");

            } catch (error) {
                Zotero.alert(null, "Zot-NASA-ADS", "An error occurred: " + error.message);
            }
        }
    },

    async updatePdfFromNasaAds() {
        // Get the selected item in Zotero.
        let selectedItems = Zotero.getActiveZoteroPane().getSelectedItems();
        if (selectedItems.length < 1) {
            Zotero.alert(null, "Zot-NASA-ADS", "Please select at least one item.");
            return;
        }

        // get API key
        let apiKey = Zotero.Prefs.get('extensions.zot-nasa-ads.api-key', true);

        for (let item of selectedItems) {
            let queryValue = this.getItemIdentifier(item);
            if (!queryValue) {
                Zotero.alert(null, "Zot-NASA-ADS", "No valid identifier found for item: " + item.getField('title'));
                continue;
            }
            let nasaAdsApiUrl = `https://api.adsabs.harvard.edu/v1/search/query?q=${queryValue}&fl=esources,bibcode&rows=1`;

            // Make the HTTP request to the NASA ADS API.
            try {
                let response = await Zotero.HTTP.request("GET", nasaAdsApiUrl, {
                    headers: {
                        "Authorization": "Bearer " + apiKey,
                    }
                });

                if (response.status !== 200) {
                    Zotero.alert(null, "Zot-NASA-ADS", "Failed to fetch data from NASA ADS.");
                    continue;
                }

                // Parse the response and update the item's metadata.
                let data = JSON.parse(response.responseText);

                if (data.response.docs.length === 0 || !data.response.docs[0].esources.includes('PUB_PDF')) {
                    Zotero.alert(null, "Zot-NASA-ADS", "Published PDF is not available for this item.");
                    continue;
                }

                // Construct the PDF download URL
                let pdfUrl = `https://ui.adsabs.harvard.edu/link_gateway/${data.response.docs[0].bibcode}/PUB_PDF`;

                // Zotero.debug(pdfUrl)

                // Download and attach the PDF
                // await Zotero.Attachments.addPDFFromURLs(item, [pdfUrl])
                cookieSandbox = new Zotero.CookieSandbox(null, 'https://ui.adsabs.harvard.edu/',
                    "", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.97 Safari/537.36")
                await Zotero.Attachments.importFromURL({
                    libraryID: item.libraryID,
                    parentItemID: item.id,
                    url: pdfUrl,
                    contentType: 'application/pdf',
                    referrer: `https://ui.adsabs.harvard.edu/`,
                    cookieSandbox: cookieSandbox,
                })

                Zotero.alert(null, "Zot-NASA-ADS", "PDF downloaded and attached to the Zotero item.");
            } catch (error) {
                Zotero.alert(null, "Zot-NASA-ADS", "An error occurred: " + error.message);
            }
        }
    },

    getItemIdentifier(item) {
        let doi = item.getField('DOI');
        // If a DOI is available, use it for the query
        if (doi) {
            queryValue = `doi:"${encodeURIComponent(doi)}"`;
        } else {
            // If no DOI is available, check the "Archive ID" field for an arXiv ID
            let identifier = item.getField('archiveID') || '';
            // If the "Archive ID" field doesn't contain an arXiv ID, try to parse the "URL" field
            if (!identifier.includes('arXiv:')) {
            let url = item.getField('url');
            let arxivMatch = url.match(/arxiv\.org\/abs\/([0-9\.]+)/i);
            if (arxivMatch) {
                identifier = 'arXiv:' + arxivMatch[1];
            }
            }
            // Use the arXiv ID for the query if it's available
            if (identifier.includes('arXiv:')) {
                queryValue = identifier;
            }
        }
        return queryValue;
    },
}