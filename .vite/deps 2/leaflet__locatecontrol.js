import {
  require_leaflet_src
} from "./chunk-M4KBMA2O.js";
import {
  __toESM
} from "./chunk-OL46QLBJ.js";

// node_modules/leaflet.locatecontrol/dist/L.Control.Locate.esm.js
var import_leaflet = __toESM(require_leaflet_src());
var METERS_TO_FEET = 3.2808399;
function addClasses(el, names) {
  names.split(" ").forEach((className) => {
    el.classList.add(className);
  });
}
function removeClasses(el, names) {
  names.split(" ").forEach((className) => {
    el.classList.remove(className);
  });
}
function createElement(tag, className, parent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  parent == null ? void 0 : parent.append(el);
  return el;
}
function cloneOptions(options) {
  const cloned = {};
  for (const key in options) {
    const val = options[key];
    if (Array.isArray(val)) {
      cloned[key] = [...val];
    } else if ((val == null ? void 0 : val.constructor) === Object) {
      cloned[key] = { ...val };
    } else {
      cloned[key] = val;
    }
  }
  return cloned;
}
var LocationMarker = import_leaflet.Marker.extend({
  initialize(latlng, options) {
    import_leaflet.Util.setOptions(this, options);
    this._latlng = latlng;
    this.createIcon();
  },
  /**
   * Create a styled circle location marker
   */
  createIcon() {
    const opt = this.options;
    const style = [
      ["stroke", opt.color],
      ["stroke-width", opt.weight],
      ["fill", opt.fillColor],
      ["fill-opacity", opt.fillOpacity],
      ["opacity", opt.opacity]
    ].filter(([, v]) => v !== void 0).map(([k, v]) => `${k}="${v}"`).join(" ");
    const icon = this._getIconSVG(opt, style);
    this._locationIcon = new import_leaflet.DivIcon({
      className: icon.className,
      html: icon.svg,
      iconSize: [icon.w, icon.h]
    });
    this.setIcon(this._locationIcon);
  },
  /**
   * Return the raw svg for the shape
   *
   * Split so can be easily overridden
   */
  _getIconSVG(options, style) {
    const r = options.radius;
    const w = options.weight;
    const s = r + w;
    const s2 = s * 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s2}" height="${s2}" version="1.1" viewBox="-${s} -${s} ${s2} ${s2}"><circle r="${r}" ${style} /></svg>`;
    return {
      className: "leaflet-control-locate-location",
      svg,
      w: s2,
      h: s2
    };
  },
  setStyle(style) {
    import_leaflet.Util.setOptions(this, style);
    this.createIcon();
  }
});
var CompassMarker = LocationMarker.extend({
  initialize(latlng, heading, options) {
    import_leaflet.Util.setOptions(this, options);
    this._latlng = latlng;
    this._heading = heading;
    this.createIcon();
  },
  setHeading(heading) {
    this._heading = heading;
  },
  /**
   * Create a styled arrow compass marker
   */
  _getIconSVG(options, style) {
    const r = options.radius;
    const s = r + options.weight + options.depth;
    const s2 = s * 2;
    const path = this._arrowPoints(r, options.width, options.depth, this._heading);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s2}" height="${s2}" version="1.1" viewBox="-${s} -${s} ${s2} ${s2}"><path d="${path}" ${style} /></svg>`;
    return {
      className: "leaflet-control-locate-heading",
      svg,
      w: s2,
      h: s2
    };
  },
  _arrowPoints(radius, width, depth, heading) {
    const φ = (heading - 90) * Math.PI / 180;
    const ux = Math.cos(φ);
    const uy = Math.sin(φ);
    const vx = -Math.sin(φ);
    const vy = Math.cos(φ);
    const h = width / 2;
    const Cx = radius * ux;
    const Cy = radius * uy;
    const B1x = Cx + h * vx;
    const B1y = Cy + h * vy;
    const B2x = Cx - h * vx;
    const B2y = Cy - h * vy;
    const Tx = Cx + depth * ux;
    const Ty = Cy + depth * uy;
    return `M ${B1x},${B1y} L ${B2x},${B2y} L ${Tx},${Ty} Z`;
  }
});
var LocateControl = import_leaflet.Control.extend({
  options: {
    /** Position of the control */
    position: "topleft",
    /** The layer that the user's location should be drawn on. By default creates a new layer. */
    layer: void 0,
    /**
     * Automatically sets the map view (zoom and pan) to the user's location as it updates.
     * While the map is following the user's location, the control is in the `following` state,
     * which changes the style of the control and the circle marker.
     *
     * Possible values:
     *  - false: never updates the map view when location changes.
     *  - 'once': set the view when the location is first determined
     *  - 'always': always updates the map view when location changes.
     *              The map view follows the user's location.
     *  - 'untilPan': like 'always', except stops updating the
     *                view if the user has manually panned the map.
     *                The map view follows the user's location until she pans.
     *  - 'untilPanOrZoom': (default) like 'always', except stops updating the
     *                view if the user has manually panned the map.
     *                The map view follows the user's location until she pans.
     */
    setView: "untilPanOrZoom",
    /**
     * Keep the current map zoom level when setting the view and only pan.
     * Can be set to:
     * - `true`: Always keep current zoom level
     * - `false`: Allow zooming (default)
     * - `[minZoom, maxZoom]`: Keep zoom only when current zoom is within the specified range
     */
    keepCurrentZoomLevel: false,
    /** After activating the plugin by clicking on the icon, zoom to the selected zoom level, even when keepCurrentZoomLevel is true. Set to 'false' to disable this feature. */
    initialZoomLevel: false,
    /**
     * This callback can be used to override the viewport tracking
     * This function should return a LatLngBounds object.
     *
     * For example to extend the viewport to ensure that a particular LatLng is visible:
     *
     * getLocationBounds: function(locationEvent) {
     *    return locationEvent.bounds.extend([-33.873085, 151.219273]);
     * },
     */
    getLocationBounds(locationEvent) {
      return locationEvent.bounds;
    },
    /** Smooth pan and zoom to the location of the marker. Only works in Leaflet 1.0+. */
    flyTo: false,
    /**
     * The user location can be inside and outside the current view when the user clicks on the
     * control that is already active. Both cases can be configures separately.
     * Possible values are:
     *  - 'setView': zoom and pan to the current location
     *  - 'stop': stop locating and remove the location marker
     */
    clickBehavior: {
      /** What should happen if the user clicks on the control while the location is within the current view. */
      inView: "stop",
      /** What should happen if the user clicks on the control while the location is outside the current view. */
      outOfView: "setView",
      /**
       * What should happen if the user clicks on the control while the location is within the current view
       * and we could be following but are not. Defaults to a special value which inherits from 'inView';
       */
      inViewNotFollowing: "inView"
    },
    /**
     * If set, save the map bounds just before centering to the user's
     * location. When control is disabled, set the view back to the
     * bounds that were saved.
     */
    returnToPrevBounds: false,
    /**
     * Keep a cache of the location after the user deactivates the control. If set to false, the user has to wait
     * until the locate API returns a new location before they see where they are again.
     */
    cacheLocation: true,
    /** If set, a circle that shows the location accuracy is drawn. */
    drawCircle: true,
    /** If set, the marker at the users' location is drawn. */
    drawMarker: true,
    /** If set and supported then show the compass heading */
    showCompass: true,
    /** The class to be used to create the marker. For example L.CircleMarker or L.Marker */
    markerClass: LocationMarker,
    /** The class us be used to create the compass bearing arrow */
    compassClass: CompassMarker,
    /** Accuracy circle style properties. NOTE these styles should match the css animations styles */
    circleStyle: {
      className: "leaflet-control-locate-circle",
      color: "#136AEC",
      fillColor: "#136AEC",
      fillOpacity: 0.15,
      weight: 0
    },
    /** Inner marker style properties. Only works if your marker class supports `setStyle`. */
    markerStyle: {
      className: "leaflet-control-locate-marker",
      color: "#fff",
      fillColor: "#2A93EE",
      fillOpacity: 1,
      weight: 3,
      opacity: 1,
      radius: 9
    },
    /** Compass */
    compassStyle: {
      fillColor: "#2A93EE",
      fillOpacity: 1,
      weight: 0,
      color: "#fff",
      opacity: 1,
      radius: 9,
      // How far is the arrow from the center of the marker
      width: 9,
      // Width of the arrow
      depth: 6
      // Length of the arrow
    },
    /**
     * Changes to accuracy circle and inner marker while following.
     * It is only necessary to provide the properties that should change.
     */
    followCircleStyle: {},
    followMarkerStyle: {
      // color: '#FFA500',
      // fillColor: '#FFB000'
    },
    followCompassStyle: {},
    /** The CSS class for the icon. For example fa-location-arrow or fa-map-marker */
    icon: "leaflet-control-locate-location-arrow",
    iconLoading: "leaflet-control-locate-spinner",
    /** The element to be created for icons. For example span or i */
    iconElementTag: "span",
    /** The element to be created for the text. For example small or span */
    textElementTag: "small",
    /** Padding around the accuracy circle. */
    circlePadding: [0, 0],
    /** Use metric units. */
    metric: true,
    /**
     * This callback can be used in case you would like to override button creation behavior.
     * This is useful for DOM manipulation frameworks such as angular etc.
     * This function should return an object with HtmlElement for the button (link property) and the icon (icon property).
     */
    createButtonCallback(container, options) {
      const link = createElement("a", "leaflet-bar-part leaflet-bar-part-single", container);
      link.title = options.strings.title;
      link.href = "#";
      link.setAttribute("role", "button");
      link.setAttribute("aria-label", options.strings.title);
      const icon = createElement(options.iconElementTag, options.icon, link);
      icon.classList.add("leaflet-locate-icon");
      if (options.strings.text !== void 0) {
        const text = createElement(options.textElementTag, "leaflet-locate-text", link);
        text.textContent = options.strings.text;
        link.classList.add("leaflet-locate-text-active");
        link.parentNode.style.display = "flex";
      }
      return { link, icon };
    },
    /** This event is called in case of any location error that is not a time out error. */
    onLocationError(err) {
      alert(err.message);
    },
    /**
     * This event is called when the user's location is outside the bounds set on the map.
     * The event is called repeatedly when the location changes.
     */
    onLocationOutsideMapBounds(control) {
      control.stop();
      alert(control.options.strings.outsideMapBoundsMsg);
    },
    /** Display a pop-up when the user click on the inner marker. */
    showPopup: true,
    strings: {
      title: "Show me where I am",
      metersUnit: "meters",
      feetUnit: "feet",
      popup: "You are within {distance} {unit} from this point",
      outsideMapBoundsMsg: "You seem located outside the boundaries of the map"
    },
    /** The default options passed to leaflets locate method. */
    locateOptions: {
      maxZoom: Infinity,
      watch: true,
      // if you overwrite this, visualization cannot be updated
      setView: false
      // have to set this to false because we have to
      // do setView manually
    }
  },
  initialize(options = {}) {
    this.options = cloneOptions(this.options);
    for (const key in options) {
      const userVal = options[key];
      const defaultVal = this.options[key];
      if ((userVal == null ? void 0 : userVal.constructor) === Object && (defaultVal == null ? void 0 : defaultVal.constructor) === Object) {
        Object.assign(defaultVal, userVal);
      } else {
        this.options[key] = userVal;
      }
    }
    this.options.followMarkerStyle = { ...this.options.markerStyle, ...this.options.followMarkerStyle };
    this.options.followCircleStyle = { ...this.options.circleStyle, ...this.options.followCircleStyle };
    this.options.followCompassStyle = { ...this.options.compassStyle, ...this.options.followCompassStyle };
  },
  /**
   * Add control to map. Returns the container for the control.
   */
  onAdd(map) {
    const container = createElement("div", "leaflet-control-locate leaflet-bar leaflet-control");
    this._container = container;
    this._map = map;
    this._layer = this.options.layer || new import_leaflet.LayerGroup();
    this._layer.addTo(map);
    this._event = void 0;
    this._compassHeading = null;
    this._prevBounds = null;
    const linkAndIcon = this.options.createButtonCallback(container, this.options);
    this._link = linkAndIcon.link;
    this._icon = linkAndIcon.icon;
    this._link.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      this._onClick();
    });
    this._link.addEventListener("dblclick", (ev) => ev.stopPropagation());
    this._resetVariables();
    this._map.on("unload", this._unload, this);
    return container;
  },
  /**
   * Called when control is removed from the map.
   */
  onRemove() {
    this.stop();
  },
  /**
   * This method is called when the user clicks on the control.
   */
  _onClick() {
    this._justClicked = true;
    const wasFollowing = this._isFollowing();
    this._userPanned = false;
    this._userZoomed = false;
    if (this._active && !this._event) {
      this.stop();
    } else if (this._active) {
      const behaviors = this.options.clickBehavior;
      let behavior = behaviors.outOfView;
      if (this._map.getBounds().contains(this._event.latlng)) {
        behavior = wasFollowing ? behaviors.inView : behaviors.inViewNotFollowing;
      }
      if (behaviors[behavior]) {
        behavior = behaviors[behavior];
      }
      switch (behavior) {
        case "setView":
          this.setView();
          break;
        case "stop":
          this.stop();
          if (this.options.returnToPrevBounds) {
            const f = this.options.flyTo ? this._map.flyToBounds : this._map.fitBounds;
            f.bind(this._map)(this._prevBounds);
          }
          break;
      }
    } else {
      if (this.options.returnToPrevBounds) {
        this._prevBounds = this._map.getBounds();
      }
      this.start();
    }
    this._updateContainerStyle();
  },
  /**
   * Starts the plugin:
   * - activates the engine
   * - draws the marker (if coordinates available)
   */
  start() {
    this._activate();
    if (this._event) {
      this._drawMarker(this._map);
      if (this.options.setView) {
        this.setView();
      }
    }
    this._updateContainerStyle();
  },
  /**
   * Stops the plugin:
   * - deactivates the engine
   * - reinitializes the button
   * - removes the marker
   */
  stop() {
    this._deactivate();
    this._cleanClasses();
    this._resetVariables();
    this._removeMarker();
  },
  /**
   * Keep the control active but stop following the location
   */
  stopFollowing() {
    this._userPanned = true;
    this._updateContainerStyle();
    this._drawMarker();
  },
  /**
   * This method launches the location engine.
   * It is called before the marker is updated,
   * event if it does not mean that the event will be ready.
   *
   * Override it if you want to add more functionalities.
   * It should set the this._active to true and do nothing if
   * this._active is true.
   */
  _activate() {
    if (this._active || !this._map) {
      return;
    }
    this._map.locate(this.options.locateOptions);
    this._map.fire("locateactivate", this);
    this._active = true;
    this._map.on("locationfound", this._onLocationFound, this);
    this._map.on("locationerror", this._onLocationError, this);
    this._map.on("dragstart", this._onDrag, this);
    this._map.on("zoomstart", this._onZoom, this);
    this._map.on("zoomend", this._onZoomEnd, this);
    this._activateCompass();
  },
  /**
   * Request DeviceOrientation permission (if needed) and bind compass events.
   * Fails gracefully — geolocation continues without compass.
   */
  async _activateCompass() {
    if (!this.options.showCompass) {
      return;
    }
    const oriAbs = "ondeviceorientationabsolute" in window;
    if (!oriAbs && !("ondeviceorientation" in window)) {
      return;
    }
    const eventName = oriAbs ? "deviceorientationabsolute" : "deviceorientation";
    if (DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      try {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        if (permissionState !== "granted") {
          return;
        }
      } catch (err) {
        console.warn("DeviceOrientation permission denied or unavailable:", err);
        return;
      }
    }
    this._compassEventName = eventName;
    import_leaflet.DomEvent.on(window, eventName, this._onDeviceOrientation, this);
  },
  /**
   * Called to stop the location engine.
   *
   * Override it to shutdown any functionalities you added on start.
   */
  _deactivate() {
    if (!this._active || !this._map) {
      return;
    }
    this._map.stopLocate();
    this._map.fire("locatedeactivate", this);
    this._active = false;
    if (!this.options.cacheLocation) {
      this._event = void 0;
    }
    this._map.off("locationfound", this._onLocationFound, this);
    this._map.off("locationerror", this._onLocationError, this);
    this._map.off("dragstart", this._onDrag, this);
    this._map.off("zoomstart", this._onZoom, this);
    this._map.off("zoomend", this._onZoomEnd, this);
    this._deactivateCompass();
  },
  /**
   * Remove compass event listener and reset compass heading state.
   * Symmetric counterpart to _activateCompass().
   */
  _deactivateCompass() {
    if (!this._compassEventName) {
      return;
    }
    this._compassHeading = null;
    import_leaflet.DomEvent.off(window, this._compassEventName, this._onDeviceOrientation, this);
    this._compassEventName = null;
  },
  /**
   * Check if the current zoom level should be kept based on keepCurrentZoomLevel option.
   * @returns {boolean} true if zoom should be kept, false otherwise
   */
  _shouldKeepCurrentZoom() {
    const option = this.options.keepCurrentZoomLevel;
    if (Array.isArray(option) && option.length === 2) {
      const currentZoom = this._map.getZoom();
      const [minZoom, maxZoom] = option;
      return currentZoom >= minZoom && currentZoom <= maxZoom;
    }
    return option === true;
  },
  /**
   * Pan and/or zoom the map to the current location.
   * Respects keepCurrentZoomLevel and initialZoomLevel options.
   */
  setView() {
    this._drawMarker();
    if (this._isOutsideMapBounds()) {
      this._event = void 0;
      this.options.onLocationOutsideMapBounds(this);
      return;
    }
    const { latlng } = this._event;
    const fly = this.options.flyTo;
    let method, args;
    if (this._justClicked && this.options.initialZoomLevel !== false) {
      method = fly ? "flyTo" : "setView";
      args = [latlng, this.options.initialZoomLevel];
    } else if (this._shouldKeepCurrentZoom()) {
      method = fly ? "flyTo" : "panTo";
      args = [latlng];
    } else {
      method = fly ? "flyToBounds" : "fitBounds";
      args = [
        this.options.getLocationBounds(this._event),
        {
          padding: this.options.circlePadding,
          maxZoom: this.options.locateOptions.maxZoom
        }
      ];
    }
    this._setViewIgnoringEvents(method, args);
  },
  /**
   * Execute a map view method while ignoring zoom/pan events to prevent breaking following mode.
   * @param {string} method - The map method name to call ('flyTo', 'setView', 'panTo', 'fitBounds', 'flyToBounds')
   * @param {Array} args - Arguments to pass to the method
   */
  _setViewIgnoringEvents(method, args) {
    this._ignoreEvent = true;
    this._map[method](...args);
    requestAnimationFrame(() => {
      this._ignoreEvent = false;
    });
  },
  /**
   *
   */
  _drawCompass() {
    if (!this._event) {
      return;
    }
    const latlng = this._event.latlng;
    if (this.options.showCompass && latlng && this._compassHeading !== null) {
      const cStyle = this._isFollowing() ? this.options.followCompassStyle : this.options.compassStyle;
      if (!this._compass) {
        this._compass = new this.options.compassClass(latlng, this._compassHeading, cStyle).addTo(this._layer);
      } else {
        this._compass.setLatLng(latlng);
        this._compass.setHeading(this._compassHeading);
        if (this._compass.setStyle) {
          this._compass.setStyle(cStyle);
        }
      }
    }
    if (this._compass && (!this.options.showCompass || this._compassHeading === null)) {
      this._compass.removeFrom(this._layer);
      this._compass = null;
    }
  },
  /**
   * Draw the marker and accuracy circle on the map.
   *
   * Uses the event retrieved from onLocationFound from the map.
   */
  _drawMarker() {
    if (!this._event) {
      return;
    }
    const latlng = this._event.latlng;
    const accuracy = this._event.accuracy ?? 0;
    const isFollowing = this._isFollowing();
    if (this.options.drawCircle) {
      const style = isFollowing ? this.options.followCircleStyle : this.options.circleStyle;
      if (this._circle) {
        this._circle.setLatLng(latlng).setRadius(accuracy).setStyle(style);
      } else {
        const options = { ...style, radius: accuracy };
        this._circle = new import_leaflet.Circle(latlng, options).addTo(this._layer);
      }
    }
    if (this.options.drawMarker) {
      const style = isFollowing ? this.options.followMarkerStyle : this.options.markerStyle;
      if (this._marker) {
        this._marker.setLatLng(latlng);
        if (this._marker.setStyle) {
          this._marker.setStyle(style);
        }
      } else {
        this._marker = new this.options.markerClass(latlng, style).addTo(this._layer);
      }
    }
    this._drawCompass();
    this._bindPopup(latlng, accuracy);
  },
  /**
   * Bind popup with location information to marker and compass.
   * @param {L.LatLng} latlng - The location to bind the popup to.
   * @param {number} accuracy - The accuracy radius in meters.
   */
  _bindPopup(latlng, accuracy) {
    var _a, _b, _c, _d;
    const t = this.options.strings.popup;
    if (!this.options.showPopup || !t) {
      return;
    }
    let distance;
    let unit;
    let altitude;
    if (this.options.metric) {
      distance = accuracy.toFixed(0);
      unit = this.options.strings.metersUnit;
      altitude = ((_a = this._event) == null ? void 0 : _a.altitude) != null ? this._event.altitude.toFixed(1) : "N/A";
    } else {
      distance = (accuracy * METERS_TO_FEET).toFixed(0);
      unit = this.options.strings.feetUnit;
      altitude = ((_b = this._event) == null ? void 0 : _b.altitude) != null ? (this._event.altitude * METERS_TO_FEET).toFixed(1) : "N/A";
    }
    const speed = ((_c = this._event) == null ? void 0 : _c.speed) != null ? this._event.speed.toFixed(2) : "N/A";
    const heading = ((_d = this._event) == null ? void 0 : _d.heading) != null ? this._event.heading.toFixed(0) : "N/A";
    const data = {
      distance,
      unit,
      lat: latlng.lat.toFixed(6),
      lng: latlng.lng.toFixed(6),
      altitude,
      speed,
      heading
    };
    let popupText;
    if (typeof t === "string") {
      popupText = import_leaflet.Util.template(t, data);
    } else if (typeof t === "function") {
      popupText = t(data);
    } else {
      popupText = t;
    }
    if (this._marker) {
      this._marker.bindPopup(popupText)._popup.setLatLng(latlng);
    }
    if (this._compass) {
      this._compass.bindPopup(popupText)._popup.setLatLng(latlng);
    }
  },
  /**
   * Remove the marker from map.
   */
  _removeMarker() {
    this._layer.clearLayers();
    this._marker = void 0;
    this._circle = void 0;
    this._compass = void 0;
  },
  /**
   * Unload the plugin and all event listeners.
   * Kind of the opposite of onAdd.
   */
  _unload() {
    this.stop();
    if (this._map) {
      this._map.off("unload", this._unload, this);
    }
  },
  /**
   * Sets the compass heading
   */
  _setCompassHeading(angle) {
    if (Number.isFinite(angle)) {
      this._compassHeading = Math.round(angle);
      requestAnimationFrame(() => this._drawCompass());
    } else {
      this._compassHeading = null;
      this._drawCompass();
    }
  },
  /**
   * If the compass fails calibration just fail safely and remove the compass
   */
  _onCompassNeedsCalibration() {
    this._setCompassHeading();
  },
  /**
   * Process and normalise compass events
   */
  _onDeviceOrientation(e) {
    if (!this._active) {
      return;
    }
    if (e.webkitCompassHeading) {
      this._setCompassHeading(e.webkitCompassHeading);
    } else if (e.absolute && e.alpha) {
      this._setCompassHeading(360 - e.alpha);
    }
  },
  /**
   * Calls deactivate and dispatches an error.
   */
  _onLocationError(err) {
    if (err.code === 3 && this.options.locateOptions.watch) {
      this._timeoutCount = (this._timeoutCount || 0) + 1;
      this._map.fire("locationtimeout", {
        error: err,
        control: this,
        count: this._timeoutCount
      });
      if (this._timeoutCount >= 3 && this._container) {
        addClasses(this._container, "locate-timeout");
      }
      return;
    }
    this._timeoutCount = 0;
    this.stop();
    this.options.onLocationError(err, this);
  },
  /**
   * Stores the received event and updates the marker.
   */
  _onLocationFound(e) {
    var _a, _b, _c, _d, _e;
    if (((_b = (_a = this._event) == null ? void 0 : _a.latlng) == null ? void 0 : _b.lat) === e.latlng.lat && ((_d = (_c = this._event) == null ? void 0 : _c.latlng) == null ? void 0 : _d.lng) === e.latlng.lng && ((_e = this._event) == null ? void 0 : _e.accuracy) === e.accuracy) {
      return;
    }
    if (!this._active) {
      return;
    }
    this._timeoutCount = 0;
    if (this._container) {
      removeClasses(this._container, "locate-timeout");
    }
    this._event = e;
    this._drawMarker();
    this._updateContainerStyle();
    this._map.fire("locatelocationfound", {
      ...e,
      control: this
    });
    switch (this.options.setView) {
      case "once":
        if (this._justClicked) {
          this.setView();
        }
        break;
      case "untilPan":
        if (!this._userPanned) {
          this.setView();
        }
        break;
      case "untilPanOrZoom":
        if (!this._userPanned && !this._userZoomed) {
          this.setView();
        }
        break;
      case "always":
        this.setView();
        break;
    }
    this._justClicked = false;
  },
  /**
   * When the user drags. Need a separate event so we can bind and unbind event listeners.
   */
  _onDrag() {
    if (this._event && !this._ignoreEvent) {
      this._userPanned = true;
      this._updateContainerStyle();
      this._drawMarker();
    }
  },
  /**
   * When the user zooms. Need a separate event so we can bind and unbind event listeners.
   */
  _onZoom() {
    if (this._event && !this._ignoreEvent) {
      this._userZoomed = true;
      this._updateContainerStyle();
      this._drawMarker();
    }
  },
  /**
   * After a zoom ends update the compass and handle sideways zooms
   */
  _onZoomEnd() {
    if (this._event) {
      this._drawCompass();
    }
    if (this._event && !this._ignoreEvent) {
      if (this._marker && !this._map.getBounds().pad(-0.3).contains(this._marker.getLatLng())) {
        this._userPanned = true;
        this._updateContainerStyle();
        this._drawMarker();
      }
    }
  },
  /**
   * Compute whether the map is following the user location with pan and zoom.
   */
  _isFollowing() {
    if (!this._active) {
      return false;
    }
    if (this.options.setView === "always") {
      return true;
    } else if (this.options.setView === "untilPan") {
      return !this._userPanned;
    } else if (this.options.setView === "untilPanOrZoom") {
      return !this._userPanned && !this._userZoomed;
    }
    return false;
  },
  /**
   * Check if location is in map bounds
   */
  _isOutsideMapBounds() {
    if (this._event === void 0) {
      return false;
    }
    return this._map.options.maxBounds && !this._map.options.maxBounds.contains(this._event.latlng);
  },
  /**
   * Toggles button class between following and active.
   */
  _updateContainerStyle() {
    if (!this._container) {
      return;
    }
    if (this._active && !this._event) {
      this._setClasses("requesting");
    } else if (this._isFollowing()) {
      this._setClasses("following");
    } else if (this._active) {
      this._setClasses("active");
    } else {
      this._cleanClasses();
    }
  },
  /**
   * Sets the CSS classes for the state.
   */
  _setClasses(state) {
    switch (state) {
      case "requesting":
        removeClasses(this._container, "active following");
        addClasses(this._container, "requesting");
        removeClasses(this._icon, this.options.icon);
        addClasses(this._icon, this.options.iconLoading);
        break;
      case "active":
        removeClasses(this._container, "requesting following");
        addClasses(this._container, "active");
        removeClasses(this._icon, this.options.iconLoading);
        addClasses(this._icon, this.options.icon);
        break;
      case "following":
        removeClasses(this._container, "requesting");
        addClasses(this._container, "active following");
        removeClasses(this._icon, this.options.iconLoading);
        addClasses(this._icon, this.options.icon);
        break;
    }
  },
  /**
   * Removes all classes from button.
   */
  _cleanClasses() {
    removeClasses(this._container, "requesting active following");
    removeClasses(this._icon, this.options.iconLoading);
    addClasses(this._icon, this.options.icon);
  },
  /**
   * Reinitializes state variables.
   */
  _resetVariables() {
    this._active = false;
    this._justClicked = false;
    this._timeoutCount = 0;
    if (this._container) {
      removeClasses(this._container, "locate-timeout");
    }
    this._userPanned = false;
    this._userZoomed = false;
  }
});
function locate(options) {
  return new LocateControl(options);
}
export {
  CompassMarker,
  LocateControl,
  LocationMarker,
  locate
};
/*! Bundled license information:

leaflet.locatecontrol/dist/L.Control.Locate.esm.js:
  (*! Version: 0.89.0
  Copyright (c) 2016 Dominik Moritz *)
  (*!
  Copyright (c) 2016 Dominik Moritz
  
  This file is part of the leaflet locate control. It is licensed under the MIT license.
  You can find the project at: https://github.com/domoritz/leaflet-locatecontrol
  *)
*/
//# sourceMappingURL=leaflet__locatecontrol.js.map
