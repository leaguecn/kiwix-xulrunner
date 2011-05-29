var _selectedLibraryContentItem = undefined;
var aria2Client = new xmlrpc_client ("rpc", "localhost", "42042", "http");
var aria2Process = null;
var jobTimer = null;

function loadBinaryResource(url) {
    var req = new XMLHttpRequest();
    req.open('GET', url, false);
    req.overrideMimeType('text/plain; charset=x-user-defined');
    req.send(null);
    if (req.status != 200) return '';
    return req.responseText;
}

function whereis(binary) {
    var env = Components.classes["@mozilla.org/process/environment;1"].
          getService(Components.interfaces.nsIEnvironment);
    var path = env.get("PATH");
    var pathArray = path.split(":");
    var i;
    var directory = Components.classes["@mozilla.org/file/local;1"].
           createInstance(Components.interfaces.nsILocalFile);

    for (i in pathArray) {
	directory.initWithPath(pathArray[i]);
	directory.append("aria2c");
	if (directory.exists())
	    return directory.path
    }
}

function startDownloader() {
    var binaryPath = whereis("aria2c");
    if (binaryPath == undefined) {
	dump("Unable to find the aria2c binary.\n");
	return;
    }

    var binary = Components.classes["@mozilla.org/file/local;1"]
	.createInstance(Components.interfaces.nsILocalFile);
    binary.initWithPath(binaryPath);
    
    aria2Process = Components.classes["@mozilla.org/process/util;1"]
	.createInstance(Components.interfaces.nsIProcess);
    aria2Process.init(binary);

    var args = [ "--enable-xml-rpc", "--xml-rpc-listen-port=42042", "--dir=" + settings.getRootPath(), "--log=" + getDownloaderLogPath(), "--allow-overwrite=true", "--disable-ipv6=true" ];
    aria2Process.run(false, args, args.length);
}

function stopDownloader() {
    if (aria2Process != null) {
	dump("killing aria2c...\n");    
	aria2Process.kill();
    }
}

function isDownloadPaused(gid) {
     var param1 = new xmlrpcval(gid, "base64");
     var param2 = new xmlrpcval("gid", "base64");
     var param3 = new xmlrpcval("status", "base64");
     var arr = [param2, param3];
     var param4 = new xmlrpcval(arr, 'array');
     var msg = new xmlrpcmsg("aria2.tellStatus", [ param1, param4 ]);
     var response = aria2Client.send(msg);
     if (response.val) {
	 var value = response.val.structMem('status').scalarVal();
	 return (value == "paused" ? true : false);
     }
     return false;
}

function startDownload(url, id) {
    /* Start downloader if necessary*/
    if (aria2Process == null) {
	startDownloader();
    }

    var backgroundTask = {
	run: function() {
	    var contentMetalink = loadBinaryResource(url);
	    var param = new xmlrpcval(contentMetalink, "base64");
	    var msg = new xmlrpcmsg("aria2.addMetalink", [ param ]);
	    var response = aria2Client.send(msg);
	    var gid = response.val.arrayMem(0).scalarVal();

	    /* set the gid */
	    var downloadsString = settings.downloads();
	    var downloadsArray = settings.unserializeDownloads(downloadsString);
	    for(var index=0; index<downloadsArray.length; index++) {
		var download = downloadsArray[index];
		if (download.id == id) {
		    download.gid = gid;
		}
	    }
	    var downloadsString = settings.serializeDownloads(downloadsArray);
	    settings.downloads(downloadsString);
	}
    }

    var thread = Components.classes["@mozilla.org/thread-manager;1"]
	.getService(Components.interfaces.nsIThreadManager)
	.newThread(0);
    thread.dispatch(backgroundTask, thread.DISPATCH_NORMAL);
}

function stopDownload(index) {
    var param = new xmlrpcval(index, "base64");
    var msg = new xmlrpcmsg("aria2.remove", [ param ]);
    var response = aria2Client.send(msg);
}

function pauseDownload(index) {
    var param = new xmlrpcval(index, "base64");
    var msg = new xmlrpcmsg("aria2.pause", [ param ]);
    var response = aria2Client.send(msg);
}

function resumeDownload(index) {
    var param = new xmlrpcval(index, "base64");
    var msg = new xmlrpcmsg("aria2.unpause", [ param ]);
    var response = aria2Client.send(msg);
}

function getDownloadStatus() {
    if (aria2Process != null) {
        var downloadsString = settings.downloads();
        var downloadsArray = settings.unserializeDownloads(downloadsString);
	var msg = new xmlrpcmsg("aria2.tellActive");
	var response = aria2Client.send(msg);
	var activeIndex = 0;

	for (var index=0; index<downloadsArray.length; index++) {
	    var download = downloadsArray[index];

	    if (download.status == 0) {
		var id = download.id;
		var gid = download.gid;
		var completed = download.completed;
		var book = library.getBookById(id);
		var size = book.size * 1024;
		var downloadStatusLabel = document.getElementById("download-status-label-" + id);
		var dowloadStatusLabelString = "Paused – " + formatFileSize(completed) + " of " + formatFileSize(size) + " (" + formatFileSize(downloadSpeed * 8) + "/s)"; 
		downloadStatusLabel.setAttribute("value", dowloadStatusLabelString);
		
		var progressbar = document.getElementById("progressbar-" + id);
		if (completed != undefined && completed != "0" && completed != "") {
		    var percent = completed / (book.size * 1024) * 100;
		    progressbar.setAttribute("value", percent);
		} else {
		    progressbar.setAttribute("value", 0);
		}
	    }
	}

	for (var index=0; index<response.val.arraySize(); index++) {
	    var downloadStatus = response.val.arrayMem(index);

	    if (downloadStatus) {
		/* Retrieve infos */
		var status = downloadStatus.structMem('status').scalarVal();
		var gid = downloadStatus.structMem('gid').scalarVal();
		var downloadSpeed = downloadStatus.structMem('downloadSpeed').scalarVal();
		var size = downloadStatus.structMem('totalLength').scalarVal();
		var completed = downloadStatus.structMem('completedLength').scalarVal();
		var percent = completed / size * 100;
		var remaining = (size - completed) / downloadSpeed;
		var remainingHours = (remaining >= 3600 ? parseInt(remaining / 3600) : 0);
		remaining = parseInt(remaining - (remainingHours * 3600));
		var remainingMinutes = (remaining >= 60 ? parseInt(remaining / 60) : 0);
		remaining = parseInt(remaining - (remainingMinutes * 60));
	    
		if (completed > 0 || downloadSpeed > 0) {

		    /* Find the corresponding download */
		    var id = "";
		    for (var index=0; index<downloadsArray.length; index++) {
			var download = downloadsArray[index];
			if (download.gid == gid)
			    id = download.id;
		    }

		    /* Update the settings */
		    download.completed = completed;
		    
		    /* Update the progressbar */
		    var progressbar = document.getElementById("progressbar-" + id);
		    progressbar.setAttribute("value", percent);
		    
		    /* Update the download status string */
		    var downloadStatusLabel = document.getElementById("download-status-label-" + id);
		    var dowloadStatusLabelString = "Time remaining: " + (remainingHours > 0 ? remainingHours + " hours, " : "") + (remainingMinutes > 0 ? remainingMinutes + " minutes, " : "") + (remainingHours == 0 && remaining > 0 ? remaining + " seconds" : "") + " – " + formatFileSize(completed) + " of " + formatFileSize(size) + " (" + formatFileSize(downloadSpeed * 8) + "/s)"; 
		    downloadStatusLabel.setAttribute("value", dowloadStatusLabelString);
		} else {
		    var downloadStatusLabel = document.getElementById("download-status-label-" + id);
		    downloadStatusLabel.setAttribute("value", "Preparing download...");
		}
	    }
	}

	var downloadsString = settings.serializeDownloads(downloadsArray);
	settings.downloads(downloadsString);
    }
}

/* Return the tmp directory path where the search index is build */
function getDownloaderLogPath() {
    return appendToPath(settings.getRootPath(), "downloader.log");
}

function formatNumber( number, decimals, dec_point, thousands_sep ) {
    var n = number, c = isNaN(decimals = Math.abs(decimals)) ? 2 : decimals;
    var d = dec_point == undefined ? "," : dec_point;
    var t = thousands_sep == undefined ? "." : thousands_sep, s = n < 0 ? "-" : "";
    var i = parseInt(n = Math.abs(+n || 0).toFixed(c)) + "", j = (j = i.length) > 3 ? j % 3 : 0;
    return s + (j ? i.substr(0, j) + t : "") + i.substr(j).replace(/(\d{3})(?=\d)/g, "$1" + t) + (c ? d + Math.abs(n - i).toFixed(c).slice(2) : "");
}

function formatFileSize(filesize) {
    if (filesize >= 1073741824) {
	filesize = formatNumber(filesize / 1073741824, 2, '.', '') + ' Gb';
    } else {
	if (filesize >= 1048576) {
	    filesize = formatNumber(filesize / 1048576, 2, '.', '') + ' Mb';
	} else {
	    if (filesize >= 1024) {
		filesize = formatNumber(filesize / 1024, 0) + ' Kb';
	    } else {
		filesize = formatNumber(filesize, 0) + ' bytes';
	    };
	};
    };

    return filesize;
};

function manageStopDownload(id) {
    var downloadButton = document.getElementById("download-button-" + id);
    downloadButton.setAttribute("style", "display: block;");
    var detailsDeck = document.getElementById("download-deck-" + id);
    detailsDeck.setAttribute("selectedIndex", "0");
}

function manageStartDownload(id, completed) {
    settings.addDownload(id);

    var downloadButton = document.getElementById("download-button-" + id);
    downloadButton.setAttribute("style", "display: none;");
    var playButton = document.getElementById("play-button-" + id);
    playButton.setAttribute("style", "display: none;");
    var pauseButton = document.getElementById("pause-button-" + id);
    pauseButton.setAttribute("style", "display: block;");
    var downloadStatusLabel = document.getElementById("download-status-label-" + id);
    downloadStatusLabel.setAttribute("value", "Preparing download...");
    var detailsDeck = document.getElementById("download-deck-" + id);
    detailsDeck.setAttribute("selectedIndex", "1");

    var book = library.getBookById(id);
    var progressbar = document.getElementById("progressbar-" + id);
    if (completed != undefined && completed != "0" && completed != "") {
	var percent = completed / (book.size * 1024) * 100;
	progressbar.setAttribute("value", percent);
    } else {
	progressbar.setAttribute("value", 0);
    }

    startDownload(book.url, book.id);
}

function manageResumeDownload(id) {
    /* User Interface update */
    var pauseButton = document.getElementById("pause-button-" + id);
    pauseButton.setAttribute("style", "display: block;");
    var playButton = document.getElementById("play-button-" + id);
    playButton.setAttribute("style", "display: none;");

    /* Pause the download */
    var downloadsString = settings.downloads();
    var downloadsArray = settings.unserializeDownloads(downloadsString);
    for(var index=0; index<downloadsArray.length; index++) {
	var download = downloadsArray[index];
	if (download.id == id) {
	    download.status = 1;
	    dump("resume download" + download.gid + "\n");
	    if (isDownloadPaused(download.gid)) {
		resumeDownload(download.gid);
	    } else {
		var book = library.getBookById(download.id);
		startDownload(book.url, book.id);
	    }
	}
    }
    var downloadsString = settings.serializeDownloads(downloadsArray);
    settings.downloads(downloadsString);
}

function managePauseDownload(id) {
    /* User Interface update */
    var pauseButton = document.getElementById("pause-button-" + id);
    pauseButton.setAttribute("style", "display: none;");
    var playButton = document.getElementById("play-button-" + id);
    playButton.setAttribute("style", "display: block;");
    var downloadButton = document.getElementById("download-button-" + id);
    downloadButton.setAttribute("style", "display: none;");
    var detailsDeck = document.getElementById("download-deck-" + id);
    detailsDeck.setAttribute("selectedIndex", "1");

    /* Pause the download */
    var downloadsString = settings.downloads();
    var downloadsArray = settings.unserializeDownloads(downloadsString);
    for(var index=0; index<downloadsArray.length; index++) {
	var download = downloadsArray[index];
	if (download.id == id) {
	    download.status = 0;
	    pauseDownload(download.gid);
	}
    }
    var downloadsString = settings.serializeDownloads(downloadsArray);
    settings.downloads(downloadsString);
}

function populateBookList(container) {
    var book;
    var backgroundColor = "#FFFFFF";
    var spacer = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
					  "spacer");
    spacer.setAttribute("flex", "1");

    /* Remove the child nodes */
    while (container.firstChild) {
	container.removeChild(container.firstChild);
    };

    /* Go through all books */
    book = library.getNextBookInList();
    while (book != undefined) {
	
	/* Create item box */
	var box = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
					   "box");
	box.setAttribute("class", "library-content-item");
	box.setAttribute("style", "background-color: " + backgroundColor + ";");
	box.setAttribute("onclick", "selectLibraryContentItem(this);");
	
	var hbox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
					    "hbox");
	hbox.setAttribute("flex", "1");
	box.appendChild(hbox);

	var faviconBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						  "box");
	faviconBox.setAttribute("class", "library-content-item-favicon");
	if (book.favicon != "")
	    faviconBox.setAttribute("style", "background-image: " + book.favicon);
	hbox.appendChild(faviconBox);

	var detailsBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						  "vbox");
	detailsBox.setAttribute("flex", "1");
	detailsBox.setAttribute("class", "library-content-item-details");
	hbox.appendChild(detailsBox);

	var titleLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						  "label");
	titleLabel.setAttribute("class", "library-content-item-title");
	titleLabel.setAttribute("value", book.title || book.path);
	detailsBox.appendChild(titleLabel);

	var description = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						   "description");
	description.setAttribute("class", "library-content-item-description");
	description.setAttribute("value", book.description);
	detailsBox.appendChild(description);

	var grid = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
					    "grid");
	var columns = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
					       "columns");

	var leftColumn = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
					      "column");
	leftColumn.setAttribute("style", "width: 400px");

        var sizeLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						  "label");
	sizeLabel.setAttribute("class", "library-content-item-detail");
	sizeLabel.setAttribute("value", "Size: " + formatFileSize(book.size * 1024) + " (" + book.articleCount + " articles, " + book.mediaCount + " medias)");
	leftColumn.appendChild(sizeLabel);

        var creatorLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						  "label");
	creatorLabel.setAttribute("class", "library-content-item-detail");
	creatorLabel.setAttribute("value", "Creator: " + book.creator);
	leftColumn.appendChild(creatorLabel);

	columns.appendChild(leftColumn);

	var rightColumn = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						   "column");

        var dateLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						 "label");
	dateLabel.setAttribute("class", "library-content-item-detail");
	dateLabel.setAttribute("value", "Created: " + book.date);
	rightColumn.appendChild(dateLabel);

        var languageLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						 "label");
	languageLabel.setAttribute("class", "library-content-item-detail");
	languageLabel.setAttribute("value", "Language: " + book.language);
	rightColumn.appendChild(languageLabel);

	columns.appendChild(rightColumn);
	grid.appendChild(columns);

        var detailsDeck = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						   "deck");
	detailsDeck.setAttribute("selectedIndex", "0");
	detailsDeck.setAttribute("id", "download-deck-" + book.id);
	detailsDeck.appendChild(grid);

	var downloadBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						   "vbox");

	if (book.path == "") {
	    var progressmeterBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
							    "hbox");
	    progressmeterBox.setAttribute("flex", "1");
	    var progressmeter = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
							 "progressmeter");
	    progressmeter.setAttribute("flex", "1");
	    progressmeter.setAttribute("id", "progressbar-" + book.id);
	    progressmeterBox.appendChild(progressmeter);
	    downloadBox.appendChild(progressmeterBox);
	    
	    var pauseButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						       "button");
	    pauseButton.setAttribute("id", "pause-button-" + book.id);
	    pauseButton.setAttribute("class", "pause mini-button");
	    pauseButton.setAttribute("onclick", "event.stopPropagation(); managePauseDownload('" + book.id + "')");
	    progressmeterBox.appendChild(pauseButton);
	    
	    var playButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						      "button");
	    playButton.setAttribute("id", "play-button-" + book.id);
	    playButton.setAttribute("class", "play mini-button");
	    playButton.setAttribute("onclick", "event.stopPropagation(); manageResumeDownload('" + book.id + "')");
	    progressmeterBox.appendChild(playButton);
	    
	    var cancelButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
							"button");
	    cancelButton.setAttribute("class", "cancel mini-button");
	    cancelButton.setAttribute("onclick", "event.stopPropagation(); manageStopDownload('" + book.id + "')");
	    progressmeterBox.appendChild(cancelButton);
	    
	    var downloadStatusLabel = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
							       "label");
	    downloadStatusLabel.setAttribute("id", "download-status-label-" + book.id);
	    downloadStatusLabel.setAttribute("value", "download details...");
	    downloadBox.appendChild(downloadStatusLabel);
	}

	detailsDeck.appendChild(downloadBox);
	detailsBox.appendChild(detailsDeck);

	/* Button box */
        var buttonBox = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
						 "vbox");
	buttonBox.setAttribute("style", "margin: 5px;");
	buttonBox.appendChild(spacer.cloneNode(true));

	if (book.path == "") {
	    var downloadButton = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", 
							  "button");
	    downloadButton.setAttribute("label", "Download");
	    downloadButton.setAttribute("id", "download-button-" + book.id);
	    downloadButton.setAttribute("onclick", "event.stopPropagation(); manageStartDownload('" + book.id + "')");
	    buttonBox.appendChild(downloadButton);
	}

	hbox.appendChild(buttonBox);

	/* Add the new item to the UI */
	container.appendChild(box);

	/* Compute new item background color */
	backgroundColor = (backgroundColor == "#FFFFFF" ? "#EEEEEE" : "#FFFFFF");
	book = library.getNextBookInList();
    }
}

function populateContentManager() {
    var container;
 
    /* Local */
    container = document.getElementById("library-content-local");
    library.listBooks("local");
    populateBookList(container);

    /* Remote */
    var onlineLibrary = loadBinaryResource(settings.libraryUrls());
    library.readFromText(onlineLibrary, false);
    container = document.getElementById("library-content-remote");
    library.listBooks("remote");
    populateBookList(container);
}

/* Show/hide library manager */
function toggleLibrary() {
    var libraryButton = getLibraryButton();
    var renderingPage = document.getElementById("rendering-page");
    var libraryPage = document.getElementById("library-page");

    if (libraryButton.getAttribute('checked') == "true") {
	activateHomeButton();
	activateBackButton();
	activateNextButton();
	activateZoomButtons();
	activateFullscreenButton();
	activateToolbarButton(getPrintButton());
	activateToolbarButton(getSearchInPlaceButton());
	activateToolbarButton(getBookmarksButton())
	libraryButton.setAttribute('checked', false);
	renderingPage.hidden = false;
	libraryPage.hidden = true;
    } else {
	desactivateHomeButton();
	desactivateBackButton();
	desactivateNextButton();
	desactivateZoomButtons();
	desactivateFullscreenButton();
	desactivateToolbarButton(getPrintButton());
	desactivateToolbarButton(getSearchInPlaceButton());
	desactivateToolbarButton(getBookmarksButton())
	libraryButton.setAttribute('checked', true);
	renderingPage.hidden = true;
	libraryPage.hidden = false;
    }
}

function resumeOngoingDownloads() {
    var downloadsString = settings.downloads();
    var downloadsArray = settings.unserializeDownloads(downloadsString);

    if (downloadsArray.length > 0 && aria2Process == null) {
	startDownloader();
    }

    for(var index=0; index<downloadsArray.length; index++) {
	var download = downloadsArray[index];
	if (download.status == 1) {
	    manageStartDownload(download.id, download.completed);
	} else {
	    managePauseDownload(download.id);
	}
    }
}

function selectLibraryMenu(menuItemId) {
    var menuItemLocal = document.getElementById("library-menuitem-local");
    var menuItemRemote = document.getElementById("library-menuitem-remote");
    var libraryDeck = document.getElementById("library-deck");

    if (menuItemId == "library-menuitem-local") {
	menuItemLocal.setAttribute("style", "background-color: white;");
	menuItemRemote.setAttribute("style", "background-color: transparent;");
	libraryDeck.selectedIndex = 0;
    } else {
	menuItemLocal.setAttribute("style", "background-color: transparent;");
	menuItemRemote.setAttribute("style", "background-color: white;")
	libraryDeck.selectedIndex = 1;
    }
}

function selectLibraryContentItem(box) {
    if (_selectedLibraryContentItem != undefined) {
	_selectedLibraryContentItem.setAttribute("style", _selectedLibraryContentItem.backGroundColorBackup);
    }

    if (box == _selectedLibraryContentItem) {
	_selectedLibraryContentItem = undefined;
	return;
    } else {
	box.backGroundColorBackup = box.getAttribute("style");
	box.setAttribute("style", "background-color: Highlight;");
	_selectedLibraryContentItem = box;
    }
}

function startDownloadObserver() {
    var backgroundTask = {
	run: function() {
	    try {
		jobTimer = Components.classes["@mozilla.org/timer;1"].createInstance(Components.interfaces.nsITimer);
		
		var jobEvent = {
		    notify: function(timer) {
			var mainThread = Components.classes["@mozilla.org/thread-manager;1"].getService().mainThread;
			mainThread.dispatch({
				run: function()
				    {
					getDownloadStatus();
				    }
			    }, Components.interfaces.nsIThread.DISPATCH_NORMAL);
		    }
		};
     
		jobTimer.initWithCallback(jobEvent, 1000, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK);
   
	    } catch(err) {
		Components.utils.reportError(err);
	    }

	}
    }

    var thread = Components.classes["@mozilla.org/thread-manager;1"]
	.getService(Components.interfaces.nsIThreadManager)
	.newThread(0);
    thread.dispatch(backgroundTask, thread.DISPATCH_NORMAL);
}
