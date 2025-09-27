/* jshint -W041 */

/* jslint browser: true*/
/* global cordova,angular,console */

//--------------------------------------------------------------------------
// This factory interacts with the ZM Event Server
// over websockets and is responsible for rendering real time notifications
//--------------------------------------------------------------------------

angular.module('zmApp.controllers')
  .factory('EventServer', ['NVR', '$rootScope', '$websocket', '$ionicPopup', '$timeout', '$q', 'zm', '$ionicPlatform', '$translate', function (NVR, $rootScope, $websocket, $ionicPopup, $timeout, $q, zm, $ionicPlatform, $translate) {

    var ws;
    var pushInited = false;
    var isTimerOn = false;
    var iClosed = false;
    var isSocketReady = false;
    var pendingMessages = [];
    var connState = {
        PENDING: 0,
        SUCCESS: 1,
        REJECT: 2
    };
    var connText = ['Pending Auth', 'Connected', 'Rejected'];

    var authState = connState.PENDING;
    var mediaPlayer = null;
    var htmlAudioPlayer = null;
    var nativeAudioPlugin = null;
    var nativeAudioPluginChecked = false;
    var nativeAudioAssetId = 'zmAlarmSound';
    var nativeAudioPreloaded = false;
    var nativeAudioPluginWarningShown = false;

    function createHtmlAudioPlayer(src) {
      if (!src) {
        return null;
      }

      try {
        var audio = new Audio(src);
        audio.load();
        return {
          play: function () {
            try {
              audio.currentTime = 0;
              var promise = audio.play();
              if (promise && typeof promise.catch === 'function') {
                promise.catch(function (err) {
                  NVR.debug('EventServer: HTML audio play failed: ' + JSON.stringify(err));
                });
              }
            } catch (err) {
              NVR.debug('EventServer: Exception playing HTML audio: ' + JSON.stringify(err));
            }
          }
        };
      } catch (err) {
        NVR.debug('EventServer: Unable to create HTML audio player: ' + JSON.stringify(err));
        return null;
      }
    }

    function getNativeAudioPlugin() {
      if (nativeAudioPluginChecked && !nativeAudioPlugin) {
        return null;
      }

      if (nativeAudioPlugin) {
        return nativeAudioPlugin;
      }

      if (typeof window === 'undefined') {
        nativeAudioPluginChecked = true;
        return null;
      }

      var plugin = null;

      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeAudio) {
        plugin = window.Capacitor.Plugins.NativeAudio;
      } else if (window.Capacitor && window.Capacitor.NativeAudio) {
        plugin = window.Capacitor.NativeAudio;
      } else if (window.NativeAudio) {
        plugin = window.NativeAudio;
      }

      nativeAudioPlugin = plugin;
      nativeAudioPluginChecked = true;
      return nativeAudioPlugin;
    }

    //--------------------------------------------------------------------------
    // called when the websocket is opened
    //--------------------------------------------------------------------------
    function handleOpen(data) {
      isSocketReady = true;
      var logData = data && data.type ? { type: data.type } : data;
      try {
        NVR.debug("EventServer: WebSocket open called with:" + JSON.stringify(logData));
      } catch (err) {
        NVR.debug('EventServer: WebSocket open event could not be stringified');
      }
      var loginData = NVR.getLogin();
      NVR.log("EventServer: openHandshake: Websocket open, sending Auth");
      sendMessage("auth", {
        user: loginData.username,
        password: loginData.password,
        monlist: loginData.eventServerMonitors,
        intlist: loginData.eventServerInterval
      });

      if ($rootScope.apnsToken != '') {
       // var plat = $ionicPlatform.is('ios') ? 'ios' : 'android';
        var ld = NVR.getLogin();
        var pushstate = ld.disablePush == true ? "disabled" : "enabled";

        NVR.debug("EventServer: openHandShake: state of push is " + pushstate);
        // let's do this only if disabled. If enabled, I suppose registration
        // will be called?
        //if (ld.disablePush)
        //console.log ("HANDSHAKE MESSAGE WITH "+$rootScope.monstring);

        sendMessage("push", {
          type: 'token',
          platform: $rootScope.platformOS,
          token: $rootScope.apnsToken,
          monlist: $rootScope.monstring,
          intlist: $rootScope.intstring,
          state: pushstate
        });
      }
    }

    function handleClose(event) {
      isSocketReady = false;
      pendingMessages = [];
      authState = connState.PENDING;

      if (iClosed) {
        NVR.debug("EventServer: App closed socket, not reconnecting");
        iClosed = false;
        return;
      }

     // console.log("*********** WEBSOCKET CLOSE CALLED");

      if (!NVR.getLogin().isUseEventServer) return;

      if (!isTimerOn) {
        NVR.log("EventServer: Will try to reconnect in 10 sec..");
        $timeout(init, 10000);
        isTimerOn = true;
      }
    }

    function handleError(event) {
     // console.log("*********** WEBSOCKET ERROR CALLED");
      if (!NVR.getLogin().isUseEventServer) return;

      isSocketReady = false;
      pendingMessages = [];
      authState = connState.PENDING;

      if (!isTimerOn) {
        NVR.log("EventServer: Will try to reconnect in 10 sec..");
        $timeout(init, 10000);
        isTimerOn = true;
      }
    }

    function handleMessage(smsg) {
      //NVR.debug ("Websocket received message:"+smsg);
      str = JSON.parse(smsg);
      NVR.debug("EventServer: Real-time event: " + JSON.stringify(str));

      // Error messages
      if (str.status != 'Success') {
        NVR.log("EventServer: Error: " + JSON.stringify(str));

        if (str.reason == 'APNSDISABLED') {
          console.log("FORCE CLOSING");
          iClosed=true;
          ws.close();
          NVR.displayBanner('error', ['Event Server: APNS disabled'], 2000, 6000);
          $rootScope.apnsToken = "";
        }
      }

      if (str.status == 'Success' ) {
        if (str.event == 'auth') {
          authState = connState.SUCCESS;

          // Now handle pending messages in queue

          if (pendingMessages.length) {
            NVR.debug("EventServer: Sending pending messages, as auth confirmation received");
            while (pendingMessages.length) {
              var p = pendingMessages.pop();
              sendMessage(p.type, p.obj);
            }
          } else {
            NVR.debug("EventServer: auth confirmation received, no pendingMessages in queue");
          }

          if (str.version == undefined)
            str.version = "0.1";
          //console.log ('************* COMPARING '+str.version+'to '+zm.minEventServerVersion);
          if (NVR.versionCompare(str.version, zm.minEventServerVersion) == -1) {
            $rootScope.zmPopup = $ionicPopup.alert({
              title: $translate.instant('kEventServerVersionTitle'),
              template: $translate.instant('kEventServerVersionBody1') + " " + str.version + ". " + $translate.instant('kEventServerVersionBody2') + " " +
              zm.minEventServerVersion,
              okText: $translate.instant('kButtonOk'),
              cancelText: $translate.instant('kButtonCancel'),
            });
          }
        } else if (str.event == 'alarm') {
          // new events

          var localNotText;
          // ZMN specific hack for Event Server
          if (str.supplementary != 'true') {
            new Audio('sounds/blop.mp3').play();
            localNotText = "";
            $rootScope.isAlarm = 1;

            // Show upto a max of 99 when it comes to display
            // so aesthetics are maintained
            if ($rootScope.alarmCount == "99") {
              $rootScope.alarmCount = "99+";
            }
            if ($rootScope.alarmCount != "99+") {
              $rootScope.alarmCount = (parseInt($rootScope.alarmCount) + 1).toString();
            }

          } else {
            NVR.debug("EventServer: received supplementary event information over websockets");
          }
          var eventsToDisplay = [];
          var listOfMonitors = [];
          for (var iter = 0; iter < str.events.length; iter++) {
            // lets stack the display so they don't overwrite
            //eventsToDisplay.push(str.events[iter].Name + ": latest new alarm (" + str.events[iter].EventId + ")");
            var txt = str.events[iter].EventId;
            if (str.events[iter].Cause) {
              txt = str.events[iter].Cause;
            }
            eventsToDisplay.push(str.events[iter].Name + ": " + txt);
            localNotText = localNotText + str.events[iter].Name + ": " + txt + ",";
            listOfMonitors.push(str.events[iter].MonitorId);
          }
          localNotText = localNotText.substring(0, localNotText.length - 1);

          // if we are in background, do a local notification, else do an in app display
          if (!NVR.isBackground()) {
            //emit alarm details - this is when received over websockets
            $rootScope.$broadcast('alarm', {
              message: listOfMonitors
            });

            if (str.supplementary != 'true') {
              NVR.debug("EventServer: App is in foreground, displaying banner");
              if (eventsToDisplay.length > 0) {
                if (eventsToDisplay.length == 1) {
                  //console.log("Single Display: " + eventsToDisplay[0]);
                  NVR.displayBanner('alarm', [eventsToDisplay[0]], 5000, 5000);
                } else {
                  NVR.displayBanner('alarm', eventsToDisplay,
                    5000, 5000 * eventsToDisplay.length);
                }
              }
            }
          } // end if ! NVR.isBackground
        } // end if type == alarm | auth
      } // end if status == success
    } // end function handleMessage

    //--------------------------------------------------------------------------
    // Called once at app start. Does a lazy definition of websockets open
    //--------------------------------------------------------------------------
    function init() {
      $rootScope.isAlarm = 0;
      $rootScope.alarmCount = "0";
      isTimerOn = false;

      var d = $q.defer();
      var loginData = NVR.getLogin();

      if (loginData.isUseEventServer == false || !loginData.eventServer) {
        NVR.log("EventServer: No Event Server present. Not initializing");
        d.reject("false");
        return d.promise;
      }

      NVR.log("EventServer: Initializing Websocket with URL " +
        loginData.eventServer);

      pendingMessages = [];
      authState = connState.PENDING;
      isSocketReady = false;

      NVR.debug('EventServer: Using built-in WebSocket implementation');
      return setupWebSocket();
    } // end function init()
    
    function setupWebSocket() {
      var loginData = NVR.getLogin();
      var d = $q.defer();
      var socket;

      try {
        socket = new WebSocket(loginData.eventServer);
      } catch (err) {
        NVR.debug('EventServer: Failed to create websocket: ' + JSON.stringify(err));
        d.reject(err);
        return d.promise;
      }

      ws = socket;

      ws.onopen = function (event) {
        handleOpen(event);
        if (!pushInited) {
          NVR.debug("Initializing push notifications");
          pushInit();
        }
        d.resolve(true);
      };

      ws.onclose = function (event) {
        handleClose(event);
        d.reject("error");
      };

      ws.onerror = function (event) {
        handleError(event);
        d.reject("error");
      };

      ws.onmessage = function (event) {
        var smsg = event.data;
        handleMessage(smsg);
      };

      return d.promise;
    }

    function disconnect() {
      authState = connState.PENDING;
      pendingMessages = [];
      isSocketReady = false;

      NVR.log("EventServer: Clearing error/close cbk, disconnecting and deleting Event Server socket...");

      if (typeof ws === 'undefined' || ws === null) {
        NVR.log("EventServer: Event server socket is empty, nothing to disconnect");
        return;
      }

      ws.onmessage = null;
      iClosed = true;
      try {
        ws.close();
      } catch (err) {
        NVR.debug('EventServer: Error closing websocket: ' + JSON.stringify(err));
      }
      ws = undefined;
    }

    function getState() {
      if (!NVR.getLogin().isUseEventServer) return "disabled";
      return connText[authState];
    }

    //--------------------------------------------------------------------------
    // Send an arbitrary object to the Event Serve
    // currently planned to use it for device token
    // isForce =1 when you need to send the message even
    // if config says ES is off. This may happen when 
    // you turn off ES and then we need sendMessage to
    // let ZMES know not to send us messages
    //--------------------------------------------------------------------------
    function sendMessage(type, obj, isForce) {

      obj.appversion = NVR.getAppVersion();
      var msg = {
        'event': type,
        'data': obj,
        'token': $rootScope.apnsToken
      };

      var jmsg = JSON.stringify(msg);
      NVR.debug("EventServer: sendMessage: received->" + jmsg);

      var ld = NVR.getLogin();
      if (ld.isUseEventServer == false && isForce != 1) {
        NVR.debug("EventServer: Not sending WSS message as event server is off");
        return;
      }

      if (typeof ws === 'undefined' || ws === null) {
        NVR.debug("EventServer: not initialized, not sending message");
        return;
      }

      if (isSocketReady == false) {
        NVR.debug("EventServer: Connection not yet ready, adding message to queue");
        pendingMessages.push ({type:type, obj:obj});
        return;
      }

      if (($rootScope.platformOS != 'desktop') && (!$rootScope.apnsToken) ) {
        NVR.debug('Mobile platform does not have a token yet, adding message to queue');
        pendingMessages.push ({type:type, obj:obj});
        return;
      }

      if (authState == connState.REJECT && type != 'auth') {
        NVR.debug("EventServer: ERROR: ES rejected authentication, not sending message");
        return;
      }

      if (authState == connState.PENDING && type != 'auth') {
        NVR.debug("EventServer: Connection not yet authenticated, adding message to queue");
        pendingMessages.push ({type:type, obj:obj});
        return;
      }
      // console.log (">>>>>>>>>>>>>>>>>EVENT SERVER SENDING: type="+type+" DATA="+JSON.stringify(obj));

      NVR.debug("EventServer: ok to send message");
  
      try {
        ws.send(jmsg);
      }
      catch (e)  {
        NVR.debug ("EventServer: Exception sending ES message: "+JSON.stringify(e));
      }
    } // end function sendMessage(type, obj, isForce)

    //--------------------------------------------------------------------------
    // Called each time we resume 
    //--------------------------------------------------------------------------
    function refresh() {
      var loginData = NVR.getLogin();

      if ((!loginData.eventServer) || (loginData.isUseEventServer == false)) {
        NVR.log("EventServer: No Event Server configured, skipping refresh");

        // Let's also make sure that if the socket was open 
        // we close it - this may happen if you disable it after using it

        if (typeof ws !== 'undefined') {
          /*(if (ws.$status() != ws.$CLOSED)
          {
              NVR.debug("Closing open websocket as event server was disabled");
              ws.$close();
          }*/
        }

        return;
      }

      if (typeof ws === 'undefined') {
        NVR.debug("EventServer: Calling websocket init");
        init();
      }

      // refresh is called when 
      // The following situations will close the socket
      // a) In iOS the client went to background -- we should reconnect
      // b) The Event Server died 
      // c) The network died
      // Seems to me in all cases we should give re-open a shot

      /*if (ws.$status() == ws.$CLOSED)
      {
          NVR.log("Websocket was closed, trying to re-open");
          ws.$open();
      }*/
    }

    function pushInit() {
      NVR.log("EventServer: Setting up push registration");

      var ld = NVR.getLogin();
      var plat = $rootScope.platformOS;
      var pushPlugin = (window.Capacitor && ((window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) || window.Capacitor.PushNotifications)) ||
        (typeof window.CapacitorPushNotifications !== 'undefined' ? window.CapacitorPushNotifications : null);

      if (plat == 'desktop') {
        NVR.log('push: Not setting up push as this is desktop.');
        return;
      }

      if (!pushPlugin) {
        NVR.log('push: Capacitor PushNotifications plugin not available');
        return;
      }

      if (pushInited) {
        NVR.debug('push: already initialized');
        return;
      }
      pushInited = true;

      var mediaSrcRelative = 'sounds/blop.mp3';
      var nativeAssetPath = 'public/sounds/blop.mp3';
      htmlAudioPlayer = createHtmlAudioPlayer(mediaSrcRelative);
      mediaPlayer = htmlAudioPlayer;

      var nativeAudio = getNativeAudioPlugin();
      if (nativeAudio && typeof nativeAudio.preload === 'function') {
        if (!nativeAudioPreloaded) {
          nativeAudio.preload({
            assetId: nativeAudioAssetId,
            assetPath: nativeAssetPath,
            audioChannelNum: 1,
            isUrl: false
          }).then(function () {
            nativeAudioPreloaded = true;
            mediaPlayer = {
              play: function () {
                return nativeAudio.play({ assetId: nativeAudioAssetId }).catch(function (err) {
                  NVR.debug('EventServer: NativeAudio play failed: ' + JSON.stringify(err));
                });
              }
            };
          }).catch(function (err) {
            if (!nativeAudioPluginWarningShown) {
              NVR.debug('EventServer: NativeAudio preload failed, using HTML audio fallback: ' + JSON.stringify(err));
              nativeAudioPluginWarningShown = true;
            }
            mediaPlayer = htmlAudioPlayer;
          });
        } else {
          mediaPlayer = {
            play: function () {
              return nativeAudio.play({ assetId: nativeAudioAssetId }).catch(function (err) {
                NVR.debug('EventServer: NativeAudio play failed: ' + JSON.stringify(err));
              });
            }
          };
        }
      } else {
        if (!nativeAudioPluginWarningShown) {
          NVR.debug('EventServer: NativeAudio plugin not available, using HTML audio fallback');
          nativeAudioPluginWarningShown = true;
        }
      }

      function registerTokenWithEventServer(tokenValue) {
        var loginData = NVR.getLogin();

        if (!loginData.isUseEventServer) {
          NVR.debug('push: Event server disabled, skipping token registration');
          return;
        }

        var pushstate = loginData.disablePush == true ? 'disabled' : 'enabled';
        var monstring = '';
        var intstring = '';

        NVR.getMonitors()
          .then(function (monitors) {
            if (loginData.eventServerMonitors != '') {
              monstring = loginData.eventServerMonitors;
              intstring = loginData.eventServerInterval;
              NVR.debug('EventServer: loading saved monitor list and interval of ' + monstring + '>>' + intstring);
            } else {
              for (var i = 0; i < monitors.length; i++) {
                monstring = monstring + monitors[i].Monitor.Id + ',';
                intstring = intstring + '0,';
              }
              if (monstring.charAt(monstring.length - 1) == ',') {
                monstring = monstring.substr(0, monstring.length - 1);
              }
              if (intstring.charAt(intstring.length - 1) == ',') {
                intstring = intstring.substr(0, intstring.length - 1);
              }
            }

            $rootScope.monstring = monstring;
            $rootScope.intstring = intstring;

            sendMessage('push', {
              type: 'token',
              platform: plat,
              token: tokenValue,
              monlist: monstring,
              intlist: intstring,
              state: pushstate
            }, 1);
          },
          function () {
            NVR.log("EventServer: Could not get monitors, can't send push reg");
          });
      }

      function normalizeNotificationData(notification, tapState) {
        var payload = {};

        if (notification && typeof notification === 'object') {
          if (notification.data !== undefined && notification.data !== null) {
            if (typeof notification.data === 'string') {
              try {
                payload = JSON.parse(notification.data);
              } catch (err) {
                NVR.debug('push: Unable to parse notification data string');
                payload = { raw: notification.data };
              }
            } else if (typeof notification.data === 'object') {
              payload = notification.data;
            }
          }

          if (!payload.eid && notification.eid) {
            payload.eid = notification.eid;
          }
          if (!payload.mid && notification.mid) {
            payload.mid = notification.mid;
          }
          if (!payload.messageType && notification.messageType) {
            payload.messageType = notification.messageType;
          }
        }

        payload.tap = tapState;
        return payload;
      }

      function handleNotification(notification, tapState) {
        $ionicPlatform.ready(function () {
          var message = normalizeNotificationData(notification, tapState);

          NVR.debug('push: EventServer: received push notification with payload:' + JSON.stringify(message));

          if ($rootScope.platformOS != 'desktop') {
            if (pushPlugin.setBadgeNumber) {
              pushPlugin.setBadgeNumber({ badge: 0 }).catch(function (err) {
                NVR.debug('push: Error clearing badge:' + JSON.stringify(err));
              });
            }
            if (pushPlugin.removeAllDeliveredNotifications) {
              pushPlugin.removeAllDeliveredNotifications().catch(function (err) {
                NVR.debug('push: Error clearing delivered notifications:' + JSON.stringify(err));
              });
            }
          }

          var loginData = NVR.getLogin();
          if (loginData.isUseEventServer == false) {
            NVR.debug('push: EventServer: received push notification, but event server disabled. Not acting on it');
            return;
          }

          NVR.debug('push: Message type received is:' + message.messageType);

          sendMessage('push', {
            type: 'badge',
            badge: 0,
          });

          var mid;
          var eid = message.eid;
          if (message.mid) {
            mid = message.mid;
            var mi = mid.indexOf(',');
            if (mi > 0) {
              mid = mid.slice(0, mi);
            }
            mid = parseInt(mid, 10);
          }

          if (tapState == 'foreground') {
            $rootScope.tappedNotification = 0;
            $rootScope.tappedEid = 0;
            $rootScope.tappedMid = 0;

            if (loginData.soundOnPush && mediaPlayer && typeof mediaPlayer.play === 'function') {
              mediaPlayer.play();
            }
            if ($rootScope.alarmCount == '99') {
              $rootScope.alarmCount = '99+';
            }
            if ($rootScope.alarmCount != '99+') {
              $rootScope.alarmCount = (parseInt($rootScope.alarmCount) + 1).toString();
            }
            $rootScope.isAlarm = 1;
          } else if (tapState == 'background') {
            $rootScope.alarmCount = '0';
            $rootScope.isAlarm = 0;
            $rootScope.tappedNotification = 1;
            $rootScope.tappedMid = mid;
            $rootScope.tappedEid = eid;
            NVR.log('EventServer: Push notification: Tapped Monitor taken as:' + $rootScope.tappedMid);

            $timeout(function () {
              NVR.debug('EventServer: broadcasting process-push');
              $rootScope.$broadcast('process-push');
            }, 100);
          } else {
            NVR.debug('push: message tap not defined');
            $rootScope.tappedNotification = 0;
            $rootScope.tappedEid = 0;
            $rootScope.tappedMid = 0;
          }
        });
      }

      if (plat == 'android') {
        var channel = {
          id: 'zmninja',
          description: 'zmNinja push',
          name: 'zmNinja',
          sound: 'default',
          vibration: true,
          light: true,
          lightColor: parseInt('FF0000FF', 16).toString(),
          importance: 4,
          badge: true,
          visibility: 1
        };

        if (pushPlugin.createChannel) {
          pushPlugin.createChannel(channel).then(function () {
            NVR.debug('push: Channel created: ' + channel.id);
          }).catch(function (error) {
            NVR.debug('push: Create channel error: ' + JSON.stringify(error));
          });
        }
      }

      if (plat == 'ios' && ld.isUseEventServer && pushPlugin.getDeliveredNotifications) {
        pushPlugin.getDeliveredNotifications().then(function (result) {
          var notifications = result && result.notifications ? result.notifications : [];
          if (notifications.length) {
            var cnt = notifications.length;
            NVR.debug('push: ios, delivered notifications count is:' + cnt);
            $rootScope.isAlarm = 1;
            $rootScope.alarmCount = cnt > 99 ? '99+' : cnt.toString();
          }
        }).catch(function (err) {
          NVR.debug('push: ios, error obtaining delivered notifications:' + JSON.stringify(err));
        });
      }

      pushPlugin.addListener('registration', function (token) {
        var tokenValue = token && token.value ? token.value : '';
        if (!tokenValue) {
          NVR.debug('push: registration returned empty token');
          return;
        }

        NVR.debug('push: got token:' + tokenValue);
        $rootScope.apnsToken = tokenValue;
        registerTokenWithEventServer(tokenValue);
      });

      pushPlugin.addListener('registrationError', function (error) {
        NVR.debug('push: Error during registration:' + JSON.stringify(error));
      });

      pushPlugin.addListener('pushNotificationReceived', function (notification) {
        handleNotification(notification, 'foreground');
      });

      pushPlugin.addListener('pushNotificationActionPerformed', function (notification) {
        if (notification && notification.notification) {
          handleNotification(notification.notification, 'background');
        } else {
          NVR.debug('push: Action performed without notification payload');
        }
      });

      pushPlugin.checkPermissions().then(function (status) {
        if (status && status.receive === 'prompt' && pushPlugin.requestPermissions) {
          return pushPlugin.requestPermissions();
        }
        return status;
      }).then(function (status) {
        if (!status || status.receive !== 'granted') {
          NVR.log('push: Permission not granted for push');
          return null;
        }
        return pushPlugin.register();
      }).catch(function (error) {
        NVR.debug('push: Error during permission/register flow:' + JSON.stringify(error));
      });
    }

    return {
      refresh: refresh,
      init: init,
      sendMessage: sendMessage,
      getState:getState,
      pushInit: pushInit,
      disconnect: disconnect
    };
  }]);
