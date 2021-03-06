'use strict';

TABS.firmware_flasher = {};
TABS.firmware_flasher.initialize = function (callback) {
    var self = this;

    if (GUI.active_tab != 'firmware_flasher') {
        GUI.active_tab = 'firmware_flasher';
        googleAnalytics.sendAppView('Firmware Flasher');
    }

    var intel_hex = false, // standard intel hex in string format
        parsed_hex = false; // parsed raw hex in array format

    $('#content').load("./tabs/firmware_flasher.html", function () {
        // translate to user-selected language
        localize();

        function parse_hex(str, callback) {
            // parsing hex in different thread
            var worker = new Worker('./js/workers/hex_parser.js');

            // "callback"
            worker.onmessage = function (event) {
                callback(event.data);
            };

            // send data/string over for processing
            worker.postMessage(str);
        }

        // UI Hooks
        $('a.load_file').click(function () {
            chrome.fileSystem.chooseEntry({type: 'openFile', accepts: [{extensions: ['hex']}]}, function (fileEntry) {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);

                    return;
                }

                // hide github info (if it exists)
                $('div.git_info').slideUp();

                chrome.fileSystem.getDisplayPath(fileEntry, function (path) {
                    console.log('Loading file from: ' + path);

                    fileEntry.file(function (file) {
                        var reader = new FileReader();

                        reader.onprogress = function (e) {
                            if (e.total > 1048576) { // 1 MB
                                // dont allow reading files bigger then 1 MB
                                console.log('File limit (1 MB) exceeded, aborting');
                                reader.abort();
                            }
                        };

                        reader.onloadend = function(e) {
                            if (e.total != 0 && e.total == e.loaded) {
                                console.log('File loaded');

                                intel_hex = e.target.result;

                                parse_hex(intel_hex, function (data) {
                                    parsed_hex = data;

                                    if (parsed_hex) {
                                        googleAnalytics.sendEvent('Flashing', 'Firmware', 'local');
                                        $('a.flash_firmware').removeClass('locked');

                                        $('span.progressLabel').text('Loaded Local Firmware: (' + parsed_hex.bytes_total + ' bytes)');
                                    } else {
                                        $('span.progressLabel').text(chrome.i18n.getMessage('firmwareFlasherHexCorrupted'));
                                    }
                                });
                            }
                        };

                        reader.readAsText(file);
                    });
                });
            });
        });

        $('a.load_remote_file').click(function () {
            function process_hex(data, development) {
                intel_hex = data;

                parse_hex(intel_hex, function (data) {
                    parsed_hex = data;

                    if (parsed_hex) {
                        var url;

                        googleAnalytics.sendEvent('Flashing', 'Firmware', 'online');
                        $('span.progressLabel').html('<a class="save_firmware" href="#" title="Save Firmware">Loaded Online Firmware: (' + parsed_hex.bytes_total + ' bytes)</a>');

                        $('a.flash_firmware').removeClass('locked');

                        if (!development) {
                            url = 'https://api.github.com/repos/multiwii/baseflight/commits?page=1&per_page=1&path=obj/baseflight.hex';
                        } else {
                            url = 'https://api.github.com/repos/multiwii/baseflight/commits/' + development.commit;
                        }

                        $.get(url, function (data) {
                            var data = (development) ? data : data[0],
                                d = new Date(data.commit.author.date),
                                offset = d.getTimezoneOffset() / 60,
                                date;

                            date = ('0' + (d.getMonth() + 1)).slice(-2) + '.' + ('0' + (d.getDate())).slice(-2) + '.' + d.getFullYear();
                            date += ' @ ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                            date += (offset > 0) ? ' GMT+' + offset : ' GMT' + offset;

                            $('div.git_info .committer').text(data.commit.author.name);
                            $('div.git_info .date').text(date);
                            $('div.git_info .message').text(data.commit.message);

                            $('div.git_info').slideDown();
                        });
                    } else {
                        $('span.progressLabel').text(chrome.i18n.getMessage('firmwareFlasherHexCorrupted'));
                    }
                });
            }

            function failed_to_load() {
                $('span.progressLabel').text(chrome.i18n.getMessage('firmwareFlasherFailedToLoadOnlineFirmware'));
                $('a.flash_firmware').addClass('locked');
            }

            if (!$('input.flash_development_firmware').is(':checked')) {
                $.get('https://raw.githubusercontent.com/multiwii/baseflight/master/obj/baseflight.hex', function (data) {
                    process_hex(data, false);
                }).fail(failed_to_load);
            } else {
                $.get('http://firmware.baseflight.net/listing.json', function (data) {
                    var filter = [],
                        time = 0,
                        obj = null;

                    // filter out what we need
                    for (var i = 0; i < data.length; i++) {
                        if (data[i].target == 'NAZE') {
                            filter.push(data[i]);
                        }
                    }

                    if (filter.length > 1) {
                        for (var i = 0; i < filter.length; i++) {
                            if (time < filter[i].time) {
                                time = filter[i].time;
                                obj = filter[i];
                            }
                        }
                    } else {
                        obj = filter[0];
                    }

                    $.get('http://firmware.baseflight.net/' + obj.file, function (data) {
                        process_hex(data, obj);
                    }).fail(failed_to_load);

                }).fail(failed_to_load);
            }
        });

        $('a.flash_firmware').click(function () {
            if (!$(this).hasClass('locked')) {
                if (!GUI.connect_lock) { // button disabled while flashing is in progress
                    if (parsed_hex != false) {
                        if (String($('div#port-picker #port').val()) != 'DFU') {
                            if (String($('div#port-picker #port').val()) != '0') {
                                var options = {},
                                    port = String($('div#port-picker #port').val()),
                                    baud;

                                switch (GUI.operating_system) {
                                    case 'Windows':
                                    case 'MacOS':
                                    case 'ChromeOS':
                                    case 'Linux':
                                    case 'UNIX':
                                        baud = 921600;
                                        break;

                                    default:
                                        baud = 115200;
                                }

                                if ($('input.updating').is(':checked')) {
                                    options.no_reboot = true;
                                } else {
                                    options.reboot_baud = parseInt($('div#port-picker #baud').val());
                                }

                                if ($('input.erase_chip').is(':checked')) {
                                    options.erase_chip = true;
                                }

                                if ($('input.flash_slowly').is(':checked')) {
                                    options.flash_slowly = true;
                                }

                                STM32.connect(port, baud, parsed_hex, options);
                            } else {
                                console.log('Please select valid serial port');
                                GUI.log('<span style="color: red">Please select valid serial port</span>');
                            }
                        } else {
                            STM32DFU.connect(usbDevices.STM32DFU, parsed_hex);
                        }
                    } else {
                        $('span.progressLabel').text(chrome.i18n.getMessage('firmwareFlasherFirmwareNotLoaded'));
                    }
                }
            }
        });

        $(document).on('click', 'span.progressLabel a.save_firmware', function () {
            chrome.fileSystem.chooseEntry({type: 'saveFile', suggestedName: 'baseflight', accepts: [{extensions: ['hex']}]}, function (fileEntry) {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);
                    return;
                }

                chrome.fileSystem.getDisplayPath(fileEntry, function (path) {
                    console.log('Saving firmware to: ' + path);

                    // check if file is writable
                    chrome.fileSystem.isWritableEntry(fileEntry, function (isWritable) {
                        if (isWritable) {
                            var blob = new Blob([intel_hex], {type: 'text/plain'});

                            fileEntry.createWriter(function (writer) {
                                var truncated = false;

                                writer.onerror = function (e) {
                                    console.error(e);
                                };

                                writer.onwriteend = function() {
                                    if (!truncated) {
                                        // onwriteend will be fired again when truncation is finished
                                        truncated = true;
                                        writer.truncate(blob.size);

                                        return;
                                    }
                                };

                                writer.write(blob);
                            }, function (e) {
                                console.error(e);
                            });
                        } else {
                            console.log('You don\'t have write permissions for this file, sorry.');
                            GUI.log('You don\'t have <span style="color: red">write permissions</span> for this file');
                        }
                    });
                });
            });
        });

        chrome.storage.local.get('no_reboot_sequence', function (result) {
            if (result.no_reboot_sequence) {
                $('input.updating').prop('checked', true);
                $('.flash_on_connect_wrapper').show();
            } else {
                $('input.updating').prop('checked', false);
            }

            // bind UI hook so the status is saved on change
            $('input.updating').change(function() {
                var status = $(this).is(':checked');

                if (status) {
                    $('.flash_on_connect_wrapper').show();
                } else {
                    $('input.flash_on_connect').prop('checked', false).change();
                    $('.flash_on_connect_wrapper').hide();
                }

                chrome.storage.local.set({'no_reboot_sequence': status});
            });
        });

        chrome.storage.local.get('flash_on_connect', function (result) {
            if (result.flash_on_connect) {
                $('input.flash_on_connect').prop('checked', true);
            } else {
                $('input.flash_on_connect').prop('checked', false);
            }

            $('input.flash_on_connect').change(function () {
                var status = $(this).is(':checked');

                if (status) {
                    var catch_new_port = function () {
                        PortHandler.port_detected('flash_detected_device', function (result) {
                            var port = result[0];

                            if (!GUI.connect_lock) {
                                GUI.log('Detected: <strong>' + port + '</strong> - triggering flash on connect');
                                console.log('Detected: ' + port + ' - triggering flash on connect');

                                // Trigger regular Flashing sequence
                                GUI.timeout_add('initialization_timeout', function () {
                                    $('a.flash_firmware').click();
                                }, 100); // timeout so bus have time to initialize after being detected by the system
                            } else {
                                GUI.log('Detected <strong>' + port + '</strong> - previous device still flashing, please replug to try again');
                            }

                            // Since current port_detected request was consumed, create new one
                            catch_new_port();
                        }, false, true);
                    };

                    catch_new_port();
                } else {
                    PortHandler.flush_callbacks();
                }

                chrome.storage.local.set({'flash_on_connect': status});
            }).change();
        });

        chrome.storage.local.get('erase_chip', function (result) {
            if (result.erase_chip) {
                $('input.erase_chip').prop('checked', true);
            } else {
                $('input.erase_chip').prop('checked', false);
            }

            // bind UI hook so the status is saved on change
            $('input.erase_chip').change(function () {
                chrome.storage.local.set({'erase_chip': $(this).is(':checked')});
            });
        });

        chrome.storage.local.get('flash_development_firmware', function (result) {
            if (result.flash_development_firmware) {
                $('input.flash_development_firmware').prop('checked', true);
            } else {
                $('input.flash_development_firmware').prop('checked', false);
            }

            // bind UI hook so the status is saved on change
            $('input.flash_development_firmware').change(function () {
                // hide github info (if it exists)
                $('a.flash_firmware').addClass('locked');
                $('div.git_info').slideUp();
                $('span.progressLabel').text(chrome.i18n.getMessage('firmwareFlasherLoadFirmwareFile'));

                chrome.storage.local.set({'flash_development_firmware': $(this).is(':checked')});
            });
        });

        chrome.storage.local.get('flash_slowly', function (result) {
            if (result.flash_slowly) {
                $('input.flash_slowly').prop('checked', true);
            } else {
                $('input.flash_slowly').prop('checked', false);
            }

            // bind UI hook so the status is saved on change
            $('input.flash_slowly').change(function () {
                chrome.storage.local.set({'flash_slowly': $(this).is(':checked')});
            });
        });

        $(document).keypress(function (e) {
            if (e.which == 13) { // enter
                // Trigger regular Flashing sequence
                $('a.flash_firmware').click();
            }
        });

        // back button
        $('a.back').click(function () {
            if (!GUI.connect_lock) { // button disabled while flashing is in progress
                GUI.tab_switch_cleanup(function () {
                    TABS.landing.initialize();
                });
            } else {
                GUI.log(chrome.i18n.getMessage('firmwareFlasherWaitForFinish'));
            }
        });

        if (callback) callback();
    });
};

TABS.firmware_flasher.cleanup = function (callback) {
    PortHandler.flush_callbacks();

    // unbind "global" events
    $(document).unbind('keypress');
    $(document).off('click', 'span.progressLabel a');

    if (callback) callback();
};