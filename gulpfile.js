var gulp = require('gulp');
var gutil = require('gulp-util');
var bower = require('bower');
var concat = require('gulp-concat');
var sass = require('gulp-sass')(require('sass'));
var cleanCss = require('gulp-clean-css');
var rename = require('gulp-rename');
var sh = require('shelljs');

var paths = {
  sass: ['./scss/**/*.scss'],
  js: ['./js/**/*.js', './www/js/**/*.js'],
  html: ['./templates/**/*.html', './*.html']
};

gulp.task('sass', function(done) {
  gulp.src('./scss/ionic.app.scss')
    .pipe(sass())
    .on('error', sass.logError)
    .pipe(gulp.dest('./www/css/'))
    .pipe(cleanCss({
      keepSpecialComments: 0
    }))
    .pipe(rename({ extname: '.min.css' }))
    .pipe(gulp.dest('./www/css/'))
    .on('end', done);
});

gulp.task('copy-html', function() {
  return gulp.src(['./templates/**/*.html', './index.html'])
    .pipe(gulp.dest('./www/'));
});

gulp.task('copy-js', function() {
  return gulp.src('./js/**/*.js')
    .pipe(gulp.dest('./www/js/'));
});

gulp.task('build', gulp.series('sass', 'copy-html', 'copy-js'));
