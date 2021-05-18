"use strict"
;(function () {
  function loadConfig() {
    const elem = document.getElementById("pdf-preview-config")
    if (elem) {
      return JSON.parse(elem.getAttribute("data-config"))
    }
    throw new Error("Could not load configuration.")
  }
  function cursorTools(name) {
    if (name === "hand") {
      return 1
    }
    return 0
  }
  function scrollMode(name) {
    switch (name) {
      case "vertical":
        return 0
      case "horizontal":
        return 1
      case "wrapped":
        return 2
      default:
        return -1
    }
  }
  function spreadMode(name) {
    switch (name) {
      case "none":
        return 0
      case "odd":
        return 1
      case "even":
        return 2
      default:
        return -1
    }
  }
  const vscodeAPI = acquireVsCodeApi()

  const logToVscode = (message) => {
    vscodeAPI.postMessage({
      type: "log",
      message: message,
    })
  }

  const errorToVscode = (errorMessage) => {
    vscodeAPI.postMessage({
      type: "error",
      errorMessage: errorMessage,
    })
  }

  const regexpTextEdit =
    /textedit:\/\/(?<filepath>.+):(?<lineStr>[0-9]+):(?<colStartStr>[0-9]+):(?<colEndStr>[0-9]+)/

  const getCodeLocationFromMatchGroups = (match) => {
    const { filepath, lineStr, colStartStr, colEndStr } = match.groups
    const line = parseInt(lineStr)
    const colStart = parseInt(colStartStr)
    const colEnd = parseInt(colEndStr)
    const codeLocation = {
      filepath: filepath,
      line: line,
      colStart: colStart,
      colEnd: colEnd,
    }
    return codeLocation
  }

  const handleTextEditLinks = async () => {
    try {
      const annotationLayerElems =
        document.getElementsByClassName("annotationLayer")
      for (const annotationsLayerElem of annotationLayerElems) {
        const hyperlinks = annotationsLayerElem.getElementsByTagName("a")

        const handleOnClick = (codeLocation) => (e) => {
          e.preventDefault()
          vscodeAPI.postMessage({
            type: "textedit",
            codeLocation: codeLocation,
          })
        }

        for (var i = 0; i < hyperlinks.length; i++) {
          const match = regexpTextEdit.exec(hyperlinks[i].href)
          if (match) {
            const codeLocation = getCodeLocationFromMatchGroups(match)
            hyperlinks[i].title = "Open in VSCode"
            hyperlinks[i].onclick = handleOnClick(codeLocation)
            hyperlinks[i].id = hyperlinks[i].href // this ID is used for code -> PDF during registerLinks
          }
        }
      }
      logToVscode("Finished handling textedits")
    } catch (err) {
      errorToVscode(`Error handling text edit links: ${err}`)
    }
  }

  const handleRegisterLinks = async () => {
    try {
      const annotationLayerElems =
        document.getElementsByClassName("annotationLayer")
      for (const annotationsLayerElem of annotationLayerElems) {
        const hyperlinks = annotationsLayerElem.getElementsByTagName("a")
        const registerLink = async (codeLocation, elementID) => {
          vscodeAPI.postMessage({
            type: "register-link",
            codeLocation: codeLocation,
            elementID: elementID,
          })
        }

        for (var i = 0; i < hyperlinks.length; i++) {
          const match = regexpTextEdit.exec(hyperlinks[i].href)
          if (match) {
            const codeLocation = getCodeLocationFromMatchGroups(match)
            registerLink(codeLocation, hyperlinks[i].href) // the href is the ID as set in handleTextEditLinks
          }
        }
      }
      logToVscode("Finished registering links")
    } catch (err) {
      errorToVscode(`Error handling register links: ${err}`)
    }
  }

  const handleGoto = async (elementID) => {
    try {
      const elem = document.getElementById(elementID)
      if (!elem) {
        throw new Error(`Unable to find element with ID: ${elementID}`)
      }
      const timeoutMS = 3000
      const blinkGotoClassName = `blink-goto`
      elem.scrollIntoView({ block: `center` })
      elem.classList.add(blinkGotoClassName)
      setTimeout(() => {
        elem.classList.remove(blinkGotoClassName)
      }, timeoutMS)
    } catch (err) {
      errorToVscode(`Error handling goto: ${err}`)
    }
  }

  /**
   * From config to PDFJS compliant settings
   */
  const shimSettingsFromConfigSettings = (configSettings) => {
    return {
      cursor: cursorTools(configSettings.cursor),
      scale: configSettings.scale,
      scrollMode: scrollMode(configSettings.scrollMode),
      spreadMode: spreadMode(configSettings.spreadMode),
      rotation: 0, // in degrees
      scrollTop: 0,
      scrollLeft: 0,
    }
  }

  const handleLoad = async () => {
    const config = loadConfig()

    let settings = shimSettingsFromConfigSettings(config.defaults)
    let documentReloading = false

    const applySettings = () => {
      // console.log(`Applying settings: ${JSON.stringify(settings)}`)
      PDFViewerApplication.pdfCursorTools.switchTool(settings.cursor)
      PDFViewerApplication.pdfViewer.currentScaleValue = settings.scale
      PDFViewerApplication.pdfViewer.scrollMode = settings.scrollMode
      PDFViewerApplication.pdfViewer.spreadMode = settings.spreadMode
      PDFViewerApplication.pdfViewer.pagesRotation = settings.rotation
      document.getElementById("viewerContainer").scrollTop = settings.scrollTop
      document.getElementById("viewerContainer").scrollLeft =
        settings.scrollLeft
    }

    const listenToSettingsChanges = () => {
      PDFViewerApplication.eventBus.on("updateviewarea", () => {
        const scrollTop = document.getElementById("viewerContainer").scrollTop
        const scrollLeft = document.getElementById("viewerContainer").scrollLeft
        if (!documentReloading) {
          // check for !documentReloading is required because if the PDF changed (e.g. due to recompilation),
          // updateviewarea gets called with reset settings.
          // console.log("updateviewarea")
          settings = {
            ...settings,
            scale: PDFViewerApplication.pdfViewer.currentScaleValue,
            scrollTop,
            scrollLeft,
            cursor: PDFViewerApplication.pdfCursorTools.activeTool,
            scrollMode: PDFViewerApplication.pdfViewer.scrollMode,
            spreadMode: PDFViewerApplication.pdfViewer.spreadMode,
          }
          // console.log(JSON.stringify(settings))
        }
      })
      PDFViewerApplication.eventBus.on("rotatecw", () => {
        // console.log("rotatecw")
        settings = {
          ...settings,
          rotation: (settings.rotation + 90) % 360,
        }
        // console.log(JSON.stringify(settings))
      })
      PDFViewerApplication.eventBus.on("rotateccw", () => {
        // console.log("rotateccw")
        settings = {
          ...settings,
          rotation: (settings.rotation - 90) % 360,
        }
        // console.log(JSON.stringify(settings))
      })
    }

    while (true) {
      try {
        await PDFViewerApplication.open(config.path)
        break
      } catch (err) {
        logToVscode(`[WARNING]: Open failed, retrying`)
        console.warn(err)
      }
    }
    PDFViewerApplication.initializedPromise
      .then(() => {
        listenToSettingsChanges()
        PDFViewerApplication.eventBus.on("pagesinit", () => {
          logToVscode("pagesinit")
          documentReloading = true
        })
        PDFViewerApplication.eventBus.on("textlayerrendered", () => {
          // console.log("textlayerrendered")
          if (documentReloading) {
            logToVscode("documentReloading")
            // This portion is fired every time the pdf is changed AND loaded successfully.
            // just always close the sidebar--it's super annoying to maintain it.
            // https://github.com/lhl2617/VSLilyPond-PDF-preview/issues/22
            PDFViewerApplication.pdfSidebar.close()
            // clear the linkRepository -- waits for "link-register-ready" to register links
            vscodeAPI.postMessage({ type: "clear-links" })
            logToVscode("Sent clear-links")
            // handle textedit links
            handleTextEditLinks()
            // apply settings
            applySettings()
            // MUST BE AFTER APPLYING SETTINGS
            documentReloading = false
          }
        })
      })
      .catch((err) => {
        console.warn(err)
      })
    window.addEventListener("message", (e) => {
      const message = e.data
      const type = message.type
      // console.log(JSON.stringify(message))
      switch (type) {
        case "reload":
          // this is not sent by vscode, but is a builtin
          logToVscode("reload")
          window.PDFViewerApplication.open(config.path)
          break
        case "goto":
          handleGoto(message.elementID)
          break
        case "link-register-ready":
          logToVscode("Received link-register-ready")
          handleRegisterLinks()
          break
        default:
          logToVscode(`Ignoring unknown message: ${JSON.stringify(message)}`)
      }
    })
  }

  window.addEventListener("load", handleLoad, { once: true })

  window.onerror = function () {
    const msg = document.createElement("body")
    msg.innerText =
      "An error occurred while loading the file. Please open it again."
    document.body = msg
  }
})()
