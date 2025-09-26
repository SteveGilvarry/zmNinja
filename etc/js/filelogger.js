/*!
 * fileLogger
 * Copyright 2016 Peter Bakondy https://github.com/pbakondy
 * See LICENSE in this repository for license information
 */
(function(){
/* global angular, console, cordova */
/* eslint no-console:0 */

// install    : cordova plugin add cordova-plugin-file
// date format: https://docs.angularjs.org/api/ng/filter/date

angular.module('fileLogger', [])

  .factory('$fileLogger', ['$q', '$window', '$timeout', '$filter',
    function ($q, $window, $timeout, $filter) {

    'use strict';


    var queue = [];
    var ongoing = false;
    var levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

    var storageFilename = 'messages.log';

    var dateFormat;
    var dateTimezone;

    function getFilesystem() {
      var cap = window.Capacitor || {};
      var plugins = cap.Plugins || {};
      return plugins.Filesystem || null;
    }

    var DEFAULT_DIRECTORY = 'DATA';

    // detecting Ripple Emulator
    // https://gist.github.com/triceam/4658021
    function isRipple() {
      return $window.parent && $window.parent.ripple;
    }

    function isBrowser() {
      return (!$window.cordova && !$window.PhoneGap && !$window.phonegap) || isRipple();
    }


    function log(level) {
      if (angular.isString(level)) {
        level = level.toUpperCase();

        if (levels.indexOf(level) === -1) {
          level = 'INFO';
        }
      } else {
        level = 'INFO';
      }

      var now = new Date();
      var timestamp = dateFormat ?
        $filter('date')(now, dateFormat, dateTimezone) : now.toJSON();

      var messages = Array.prototype.slice.call(arguments, 1);
      var message = [ timestamp, level ];
      var text;

      for (var i = 0; i < messages.length; i++ ) {
        if (angular.isArray(messages[i])) {
          text = '[Array]';
          try {
            // avoid "TypeError: Converting circular structure to JSON"
            text = JSON.stringify(messages[i]);
          } catch(e) {
            // do nothing
          }
          message.push(text);
        }
        else if (angular.isObject(messages[i])) {
          text = '[Object]';
          try {
            // avoid "TypeError: Converting circular structure to JSON"
            text = JSON.stringify(messages[i]);
          } catch(e) {
            // do nothing
          }
          message.push(text);
        }
        else {
          message.push(messages[i]);
        }
      }

      if (isBrowser()) {
        // log to browser console

        messages.unshift(timestamp);

        if (angular.isObject(console) && angular.isFunction(console.log)) {
          switch (level) {
            case 'DEBUG':
              if (angular.isFunction(console.debug)) {
                console.debug.apply(console, messages);
              } else {
                console.log.apply(console, messages);
              }
              break;
            case 'INFO':
              if (angular.isFunction(console.debug)) {
                console.info.apply(console, messages);
              } else {
                console.log.apply(console, messages);
              }
              break;
            case 'WARN':
              if (angular.isFunction(console.debug)) {
                console.warn.apply(console, messages);
              } else {
                console.log.apply(console, messages);
              }
              break;
            case 'ERROR':
              if (angular.isFunction(console.debug)) {
                console.error.apply(console, messages);
              } else {
                console.log.apply(console, messages);
              }
              break;
            default:
              console.log.apply(console, messages);
          }
        }

      } else {
        // log to logcat
        console.log(message.join(' '));
      }

      queue.push({ message: message.join(' ') + '\n' });

      if (!ongoing) {
        process();
      }
    }


    function process() {

      if (!queue.length) {
        ongoing = false;
        return;
      }

      ongoing = true;
      var m = queue.shift();

      writeLog(m.message).then(
        function() {
          $timeout(function() {
            process();
          });
        },
        function() {
          $timeout(function() {
            process();
          });
        }
      );

    }


    function writeLog(message) {
      var q = $q.defer();

      if (isBrowser()) {
        // running in browser with 'ionic serve'

        if (!$window.localStorage[storageFilename]) {
          $window.localStorage[storageFilename] = '';
        }

        $window.localStorage[storageFilename] += message;
        q.resolve();

      } else {

        var Filesystem = getFilesystem();
        if (!Filesystem) {
          q.reject('Capacitor Filesystem is not available');
          return q.promise;
        }

        Filesystem.appendFile({
          path: storageFilename,
          data: message,
          directory: DEFAULT_DIRECTORY,
          encoding: 'utf8'
        }).then(function () {
          q.resolve();
        }).catch(function () {
          Filesystem.writeFile({
            path: storageFilename,
            data: message,
            directory: DEFAULT_DIRECTORY,
            encoding: 'utf8',
            recursive: true
          }).then(function () {
            q.resolve();
          }).catch(function (error) {
            q.reject(error);
          });
        });

      }

      return q.promise;
    }


    function getLogfile() {
      var q = $q.defer();

      if (isBrowser()) {
        q.resolve($window.localStorage[storageFilename]);
      } else {

        var Filesystem = getFilesystem();
        if (!Filesystem) {
          q.reject('Capacitor Filesystem is not available');
          return q.promise;
        }

        Filesystem.readFile({
          path: storageFilename,
          directory: DEFAULT_DIRECTORY,
          encoding: 'utf8'
        }).then(function (result) {
          q.resolve(result.data || '');
        }, function (error) {
          q.reject(error);
        });
      }

      return q.promise;
    }


    function deleteLogfile() {
      var q = $q.defer();

      if (isBrowser()) {
        $window.localStorage.removeItem(storageFilename);
        q.resolve();
      } else {

        var Filesystem = getFilesystem();
        if (!Filesystem) {
          q.reject('Capacitor Filesystem is not available');
          return q.promise;
        }

        Filesystem.deleteFile({
          path: storageFilename,
          directory: DEFAULT_DIRECTORY
        }).then(function (result) {
          q.resolve(result);
        }, function (error) {
          q.reject(error);
        });
      }

      return q.promise;
    }


    function setStorageFilename(filename) {
      if (angular.isString(filename) && filename.length > 0) {
        storageFilename = filename;
        return true;
      } else {
        return false;
      }
    }


    function setTimestampFormat(format, timezone) {
      if (!(angular.isUndefined(format) || angular.isString(format))) {
        throw new TypeError('format parameter must be a string or undefined');
      }
      if (!(angular.isUndefined(timezone) || angular.isString(timezone))) {
        throw new TypeError('timezone parameter must be a string or undefined');
      }

      dateFormat = format;
      dateTimezone = timezone;
    }


    function checkFile() {
      var q = $q.defer();

      if (isBrowser()) {

        q.resolve({
          name: storageFilename,
          uri: null,
          size: ($window.localStorage[storageFilename] ? $window.localStorage[storageFilename].length : 0)
        });

      } else {

        var Filesystem = getFilesystem();
        if (!Filesystem) {
          q.reject('Capacitor Filesystem is not available');
          return q.promise;
        }

        Filesystem.stat({
          path: storageFilename,
          directory: DEFAULT_DIRECTORY
        }).then(function (info) {
          return Filesystem.getUri({
            path: storageFilename,
            directory: DEFAULT_DIRECTORY
          }).then(function (uriRes) {
            q.resolve({
              name: storageFilename,
              uri: uriRes.uri,
              size: info.size
            });
          });
        }).catch(function () {
          Filesystem.writeFile({
            path: storageFilename,
            data: '',
            directory: DEFAULT_DIRECTORY,
            encoding: 'utf8',
            recursive: true
          }).then(function () {
            return Filesystem.getUri({
              path: storageFilename,
              directory: DEFAULT_DIRECTORY
            }).then(function (uriRes) {
              q.resolve({
                name: storageFilename,
                uri: uriRes.uri,
                size: 0
              });
            });
          }).catch(q.reject);
        });

      }

      return q.promise;
    }

    function debug() {
      var args = Array.prototype.slice.call(arguments, 0);
      args.unshift('DEBUG');
      log.apply(undefined, args);
    }


    function info() {
      var args = Array.prototype.slice.call(arguments, 0);
      args.unshift('INFO');
      log.apply(undefined, args);
    }


    function warn() {
      var args = Array.prototype.slice.call(arguments, 0);
      args.unshift('WARN');
      log.apply(undefined, args);
    }


    function error() {
      var args = Array.prototype.slice.call(arguments, 0);
      args.unshift('ERROR');
      log.apply(undefined, args);
    }


    return {
      log: log,
      getLogfile: getLogfile,
      deleteLogfile: deleteLogfile,
      setStorageFilename: setStorageFilename,
      setTimestampFormat: setTimestampFormat,
      checkFile: checkFile,
      debug: debug,
      info: info,
      warn: warn,
      error: error
    };

  }]);

})();
