/*!
 * clocklab.net — the bezel.
 * A static ring of 60 tick marks (12 majors, chronograph-style) with a
 * dynamic overlay that always encodes real time information:
 *   - "arc"   mode: a progress arc that sweeps as a countdown/interval/
 *              pomodoro phase elapses (fraction = time remaining / total)
 *   - "sweep" mode: a continuously rotating hand, one revolution per
 *              minute, for the stopwatch
 *   - "clock" mode: static hour + minute hands pointing at a set time,
 *              for the alarm clock
 * This is the signature visual element shared across every timer page.
 */
(function (global) {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";
  var CX = 150,
    CY = 150,
    R_OUTER = 140;

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        node.setAttribute(k, attrs[k]);
      }
    }
    return node;
  }

  function buildTicks(count, majorEvery) {
    var g = el("g", { class: "bezel-ticks" });
    for (var i = 0; i < count; i++) {
      var angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      var isMajor = i % majorEvery === 0;
      var len = isMajor ? 16 : 8;
      var r1 = R_OUTER;
      var r2 = R_OUTER - len;
      var x1 = CX + r1 * Math.cos(angle);
      var y1 = CY + r1 * Math.sin(angle);
      var x2 = CX + r2 * Math.cos(angle);
      var y2 = CY + r2 * Math.sin(angle);
      g.appendChild(
        el("line", {
          class: "tick" + (isMajor ? " major" : ""),
          x1: x1.toFixed(2),
          y1: y1.toFixed(2),
          x2: x2.toFixed(2),
          y2: y2.toFixed(2),
        })
      );
    }
    return g;
  }

  function buildBaseSvg() {
    var svg = el("svg", { viewBox: "0 0 300 300", "aria-hidden": "true" });
    svg.appendChild(buildTicks(60, 5));
    return svg;
  }

  var ARC_R = 128;
  var ARC_CIRC = 2 * Math.PI * ARC_R;

  function mountArc(container) {
    var base = buildBaseSvg();
    container.appendChild(base);

    var overlay = el("svg", { viewBox: "0 0 300 300", "aria-hidden": "true" });
    var circle = el("circle", {
      class: "dial-progress",
      cx: CX,
      cy: CY,
      r: ARC_R,
      "stroke-dasharray": ARC_CIRC.toFixed(2),
      "stroke-dashoffset": "0",
    });
    overlay.appendChild(circle);
    container.appendChild(overlay);

    return {
      // fraction: 0 = empty ring, 1 = full ring.
      // variant: true/"ringing" for an alarm state, "break" for a rest/
      // break phase (cyan), anything else for the default amber.
      setProgress: function (fraction, variant) {
        var f = Math.max(0, Math.min(1, fraction));
        circle.setAttribute("stroke-dashoffset", (ARC_CIRC * (1 - f)).toFixed(2));
        circle.classList.toggle("is-ringing", variant === true || variant === "ringing");
        circle.classList.toggle("is-break", variant === "break");
      },
    };
  }

  function mountSweep(container) {
    var base = buildBaseSvg();
    container.appendChild(base);

    var overlay = el("svg", { viewBox: "0 0 300 300", "aria-hidden": "true" });
    var hand = el("line", {
      class: "dial-needle",
      x1: CX,
      y1: CY,
      x2: CX,
      y2: CY - 120,
    });
    var hub = el("circle", { class: "dial-hub", cx: CX, cy: CY, r: 5 });
    overlay.appendChild(hand);
    overlay.appendChild(hub);
    container.appendChild(overlay);

    return {
      // degrees, 0 = 12 o'clock, clockwise
      setAngle: function (deg) {
        hand.style.transform = "rotate(" + deg + "deg)";
      },
    };
  }

  function mountClock(container) {
    var base = buildBaseSvg();
    container.appendChild(base);

    var overlay = el("svg", { viewBox: "0 0 300 300", "aria-hidden": "true" });
    var hourHand = el("line", {
      class: "dial-needle hour",
      x1: CX,
      y1: CY,
      x2: CX,
      y2: CY - 78,
    });
    var minHand = el("line", {
      class: "dial-needle",
      x1: CX,
      y1: CY,
      x2: CX,
      y2: CY - 118,
    });
    var hub = el("circle", { class: "dial-hub", cx: CX, cy: CY, r: 5 });
    var marker = el("circle", {
      class: "dial-marker",
      cx: CX,
      cy: CY - R_OUTER + 8,
      r: 5,
      hidden: "hidden",
    });
    marker.style.transformOrigin = CX + "px " + CY + "px";
    overlay.appendChild(hourHand);
    overlay.appendChild(minHand);
    overlay.appendChild(marker);
    overlay.appendChild(hub);
    container.appendChild(overlay);

    return {
      setHands: function (hourDeg, minDeg) {
        hourHand.style.transform = "rotate(" + hourDeg + "deg)";
        minHand.style.transform = "rotate(" + minDeg + "deg)";
      },
      // deg: position on the 12-hour face (0 = 12 o'clock) marking a
      // target time — used by the alarm clock to show when it will ring.
      setMarker: function (deg) {
        marker.removeAttribute("hidden");
        marker.style.transform = "rotate(" + deg + "deg)";
      },
      clearMarker: function () {
        marker.setAttribute("hidden", "hidden");
      },
    };
  }

  global.ClockLabDial = {
    mount: function (container, mode) {
      container.innerHTML = "";
      if (mode === "sweep") return mountSweep(container);
      if (mode === "clock") return mountClock(container);
      return mountArc(container);
    },
  };
})(window);
