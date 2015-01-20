'use strict';

TABS.gps = {};
TABS.gps.initialize = function (callback) {
    var self = this;

    if (GUI.active_tab != 'gps') {
        GUI.active_tab = 'gps';
        googleAnalytics.sendAppView('GPS');
    }

    function load_html() {
        $('#content').load("./tabs/gps.html", process_html);
    }

    MSP.send_message(MSP_codes.MSP_RAW_GPS, false, false, load_html);

    function process_html() {
        var gps_hp_lat = 0;
        var gps_hp_lon = 0;
        // translate to user-selected language
        localize();

        function get_raw_gps_data() {
            MSP.send_message(MSP_codes.MSP_RAW_GPS, false, false, get_comp_gps_data);
        }

        function get_comp_gps_data() {
            MSP.send_message(MSP_codes.MSP_COMP_GPS, false, false, get_gpsvinfo_data);
        }

        function get_gpsvinfo_data() {
            MSP.send_message(MSP_codes.MSP_GPSSVINFO, false, false, get_gpsdebug_data);
        }

        function get_gpsdebug_data() {
            MSP.send_message(MSP_codes.MSP_GPSDEBUGINFO, false, false, update_ui);
        }

        function update_ui() {
            var lat = GPS_DATA.lat / 10000000;
            var lon = GPS_DATA.lon / 10000000;
            var url = 'https://maps.google.com/?q=' + lat + ',' + lon;

            $('.GPS_info td.fix').html((GPS_DATA.fix) ? chrome.i18n.getMessage('gpsFixTrue') : chrome.i18n.getMessage('gpsFixFalse'));
            $('.GPS_info td.alt').text(GPS_DATA.alt + ' m');
            $('.GPS_info td.lat a').prop('href', url).text(lat.toFixed(4) + ' deg');
            $('.GPS_info td.lon a').prop('href', url).text(lon.toFixed(4) + ' deg');
            $('.GPS_info td.speed').text(GPS_DATA.speed + ' cm/s');
            $('.GPS_info td.sats').text(GPS_DATA.numSat);
            $('.GPS_info td.distToHome').text(GPS_DATA.distanceToHome + ' m');

            // Update GPS Signal Strengths
            var e_ss_table = $('div.GPS_signal_strength table tr:not(.titles)');

            for (var i = 0; i < GPS_DATA.chn.length; i++) {
                var row = e_ss_table.eq(i);

                $('td', row).eq(0).text(GPS_DATA.svid[i]);
                $('td', row).eq(1).text(GPS_DATA.quality[i]);
                $('td', row).eq(2).find('progress').val(GPS_DATA.cno[i]);
            }
            
            // Update GPS debug data
            if (GPS_DATA.updateRate < 10 || GPS_DATA.updateRate == '')
                $('.GPS_debug td.updateRate').text('- ms');
            else
                $('.GPS_debug td.updateRate').text(GPS_DATA.updateRate + ' ms');

            if (GPS_DATA.gpsHoldPos) {
                if (gps_hp_lat == 0) {
                    gps_hp_lat = GPS_DATA.lat;
                    gps_hp_lon = GPS_DATA.lon;
                }
                var scaleDown = Math.cos((Math.abs(GPS_DATA.lat) / 10000000) * 0.0174532925);
                var latDiff = gps_hp_lat - GPS_DATA.lat;
                var lonDiff = (gps_hp_lon - GPS_DATA.lon) * scaleDown;
                var dist = Math.sqrt((latDiff * latDiff) + (lonDiff * lonDiff)) * 1.113195;
                $('.GPS_debug td.latdiff').text(Math.round(latDiff));
                $('.GPS_debug td.londiff').text(Math.round(lonDiff));
                $('.GPS_debug td.posdiff').text(Math.round(dist) + ' cm');
            }
            else {
                gps_hp_lat = 0;
                gps_hp_lon = 0;
                $('.GPS_debug td.latdiff').text('-');
                $('.GPS_debug td.londiff').text('-');
                $('.GPS_debug td.posdiff').text('- cm');
            }
        }

        // enable data pulling
        GUI.interval_add('gps_pull', get_raw_gps_data, 75, true);

        // status data pulled via separate timer with static speed
        GUI.interval_add('status_pull', function status_pull() {
            MSP.send_message(MSP_codes.MSP_STATUS);
        }, 250, true);

        if (callback) callback();
    }
};

TABS.gps.cleanup = function (callback) {
    if (callback) callback();
};