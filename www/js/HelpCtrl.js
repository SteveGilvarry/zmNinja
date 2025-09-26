/* jshint -W041 */
/* jslint browser: true*/
/* global StatusBar,angular,console, Masonry */

angular.module('zmApp.controllers').controller('zmApp.HelpCtrl', ['$scope', '$rootScope', '$ionicModal', 'NVR', '$ionicSideMenuDelegate', '$ionicHistory', '$state', '$translate', '$q', '$templateRequest', '$sce', '$compile', function ($scope, $rootScope, $ionicModal, NVR, $ionicSideMenuDelegate, $ionicHistory, $state, $translate, $q, $templateRequest, $sce, $compile) {
  $scope.openMenu = function () {
    $ionicSideMenuDelegate.toggleLeft();
  };

  //----------------------------------------------------------------
  // Alarm notification handling
  //----------------------------------------------------------------
  $scope.handleAlarms = function () {
    $rootScope.isAlarm = !$rootScope.isAlarm;
    if (!$rootScope.isAlarm) {
      $rootScope.alarmCount = "0";
      $ionicHistory.nextViewOptions({
        disableBack: true
      });
      $state.go("app.events", {
        "id": 0,
        "playEvent": false
      }, {
        reload: true
      });
      return;
    }
  };

  //----------------------------------------------------------------
  // This function dynamically inserts the relevant help text file
  // based on selected language
  //----------------------------------------------------------------

  function insertHelp() {

    var l = NVR.getDefaultLanguage() || 'en';
    var lang = "lang/help/help-" + l + ".html";
    //console.log ("LANG IS " + lang);
    var templateUrl = $sce.getTrustedResourceUrl(lang);
    var lang_fb = "lang/help/help-" + "en" + ".html";
    var templateUrlFB = $sce.getTrustedResourceUrl(lang_fb);

    $templateRequest(lang)
      .then(function (template) {
          var elem = angular.element(document.getElementById('insertHelp'));
          $compile(elem.html(template).contents())($scope);
        },
        function (error) {
          NVR.log("Language file " + lang + " not found, falling back");
          $templateRequest(templateUrlFB)
            .then(function (template) {
                var elem = angular.element(document.getElementById('insertHelp'));
                $compile(elem.html(template).contents())($scope);
              },
              function (error) {
                NVR.log("fallback help not found");
              });
        }
      );

  }

  function getCapacitorBrowserPlugin() {
    if (typeof window === 'undefined' || !window.Capacitor) {
      return null;
    }

    if (window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
      return window.Capacitor.Plugins.Browser;
    }

    if (window.Capacitor.Browser) {
      return window.Capacitor.Browser;
    }

    return null;
  }

  $scope.launchUrl = function (url) {
    if (!url) {
      return false;
    }

    var browser = getCapacitorBrowserPlugin();
    if (browser && typeof browser.open === 'function') {
      browser.open({
        url: url,
        presentationStyle: 'fullscreen'
      }).catch(function (err) {
        NVR.log('Capacitor Browser open failed: ' + JSON.stringify(err));
        window.open(url, '_blank');
      });
    } else {
      NVR.log('Capacitor Browser not available, falling back to window.open');
      window.open(url, '_blank');
    }

    return false;
  };

  //-------------------------------------------------------------------------
  // Lets make sure we set screen dim properly as we enter
  // The problem is we enter other states before we leave previous states
  // from a callback perspective in ionic, so we really can't predictably
  // reset power state on exit as if it is called after we enter another
  // state, that effectively overwrites current view power management needs
  //------------------------------------------------------------------------
  $scope.$on('$ionicView.enter', function () {
    //console.log("**VIEW ** Help Ctrl Entered");
    NVR.setAwake(false);
    $scope.zmAppVersion = NVR.getAppVersion();
    insertHelp();

  });

}]);
