var childProcess = require('child_process')
var colorette = require('colorette')
var escalade = require('escalade/sync')
var path = require('path')
var fs = require('fs')

var BrowserslistError = require('./error')

var red = colorette.red
var bold = colorette.bold
var green = colorette.green
var yellow = colorette.yellow

function detectLockfile () {
  var packageDir = escalade('.', function (dir, names) {
    return names.indexOf('package.json') !== -1 ? dir : ''
  })

  if (!packageDir) {
    throw new BrowserslistError(
      'Cannot find package.json. ' +
      'Is it a right project to run npx browserslist --update-db?'
    )
  }

  var lockfileNpm = path.join(packageDir, 'package-lock.json')
  var lockfileYarn = path.join(packageDir, 'yarn.lock')
  var lockfilePnpm = path.join(packageDir, 'pnpm-lock.yaml')

  /* istanbul ignore next */
  if (fs.existsSync(lockfilePnpm)) {
    return { mode: 'pnpm', file: lockfilePnpm }
  } else if (fs.existsSync(lockfileNpm)) {
    return { mode: 'npm', file: lockfileNpm }
  } else if (fs.existsSync(lockfileYarn)) {
    return { mode: 'yarn', file: lockfileYarn }
  } else {
    throw new BrowserslistError(
      'No lockfile found. Run "npm install", "yarn install" or "pnpm install"'
    )
  }
}

function getCurrentVersion (lock) {
  var match
  /* istanbul ignore if */
  if (lock.mode === 'pnpm') {
    match = /\/caniuse-lite\/([^:]+):/.exec(lock.content)
    if (match[1]) return match[1]
  } else if (lock.mode === 'npm') {
    var dependencies = JSON.parse(lock.content).dependencies
    if (dependencies && dependencies['caniuse-lite']) {
      return dependencies['caniuse-lite'].version
    }
  } else if (lock.mode === 'yarn') {
    match = /caniuse-lite@[^:]+:\r?\n\s+version\s+"([^"]+)"/.exec(lock.content)
    if (match[1]) return match[1]
  }
  return null
}

function getLatestInfo (lock) {
  if (lock.mode !== 'yarn') {
    return JSON.parse(
      childProcess.execSync('npm show caniuse-lite --json').toString()
    )
  } else {
    return JSON.parse(
      childProcess.execSync('yarn info caniuse-lite --json').toString()
    ).data
  }
}

function getBrowsersList () {
  return childProcess.execSync('npx browserslist').toString()
    .trim()
    .split('\n')
    .map(function (line) {
      return line.trim().split(' ')
    })
    .reduce(function (result, entry) {
      if (!result[entry[0]]) {
        result[entry[0]] = []
      }
      result[entry[0]].push(entry[1])
      return result
    }, {})
}

function diffBrowsersLists (old, current) {
  var browsers = Object.keys(old).concat(
    Object.keys(current).filter(function (browser) {
      return old[browser] === undefined
    })
  )
  return browsers.map(function (browser) {
    var oldVersions = old[browser] || []
    var currentVersions = current[browser] || []
    var intersection = oldVersions.filter(function (version) {
      return currentVersions.indexOf(version) !== -1
    })
    var addedVersions = currentVersions.filter(function (version) {
      return intersection.indexOf(version) === -1
    })
    var removedVersions = oldVersions.filter(function (version) {
      return intersection.indexOf(version) === -1
    })
    return removedVersions.map(function (version) {
      return red('- ' + browser + ' ' + version)
    }).concat(addedVersions.map(function (version) {
      return green('+ ' + browser + ' ' + version)
    }))
  })
    .reduce(function (result, array) {
      return result.concat(array)
    }, [])
    .join('\n')
}

function updateLockfile (lock, latest) {
  if (lock.mode === 'npm') {
    var fixed = deletePackage(JSON.parse(lock.content))
    return JSON.stringify(fixed, null, '  ')
  } else {
    var lines = lock.content.split('\n')
    var i
    /* istanbul ignore if */
    if (lock.mode === 'pnpm') {
      for (i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('caniuse-lite:') >= 0) {
          lines[i] = lines[i].replace(/: .*$/, ': ' + latest.version)
        } else if (lines[i].indexOf('/caniuse-lite') >= 0) {
          lines[i] = lines[i].replace(/\/[^/:]+:/, '/' + latest.version + ':')
          for (i = i + 1; i < lines.length; i++) {
            if (lines[i].indexOf('integrity: ') !== -1) {
              lines[i] = lines[i].replace(
                /integrity: .+/, 'integrity: ' + latest.dist.integrity
              )
            } else if (lines[i].indexOf(' /') !== -1) {
              break
            }
          }
        }
      }
    } else if (lock.mode === 'yarn') {
      for (i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('caniuse-lite@') !== -1) {
          lines[i + 1] = lines[i + 1].replace(
            /version "[^"]+"/, 'version "' + latest.version + '"'
          )
          lines[i + 2] = lines[i + 2].replace(
            /resolved "[^"]+"/, 'resolved "' + latest.dist.tarball + '"'
          )
          lines[i + 3] = lines[i + 3].replace(
            /integrity .+/, 'integrity ' + latest.dist.integrity
          )
          i += 4
        }
      }
    }
    return lines.join('\n')
  }
}

function deletePackage (node) {
  if (node.dependencies) {
    delete node.dependencies['caniuse-lite']
    for (var i in node.dependencies) {
      node.dependencies[i] = deletePackage(node.dependencies[i])
    }
  }
  return node
}

module.exports = function updateDB (print) {
  var lock = detectLockfile()
  lock.content = fs.readFileSync(lock.file).toString()

  var current = getCurrentVersion(lock)
  var latest = getLatestInfo(lock)
  var browsersListRetrievalError
  var oldBrowsersList
  try {
    oldBrowsersList = getBrowsersList()
  } catch (e) {
    browsersListRetrievalError = e
  }

  if (typeof current === 'string') {
    print('Current version: ' + bold(red(current)) + '\n')
  }
  print(
    'New version:     ' + bold(green(latest.version)) + '\n' +
    'Removing old caniuse-lite from lock file\n'
  )

  fs.writeFileSync(lock.file, updateLockfile(lock, latest))

  var install = lock.mode === 'yarn' ? 'yarn add -W' : lock.mode + ' install'
  print(
    'Installing new caniuse-lite version\n' +
    yellow('$ ' + install + ' caniuse-lite') + '\n'
  )
  try {
    childProcess.execSync(install + ' caniuse-lite')
  } catch (e) /* istanbul ignore next */ {
    print(
      red(
        '\n' +
        e.stack + '\n\n' +
        'Problem with `' + install + '  caniuse-lite` call. ' +
        'Run it manually.\n'
      )
    )
    process.exit(1)
  }

  var del = lock.mode === 'yarn' ? 'yarn remove -W' : lock.mode + ' uninstall'
  print(
    'Cleaning package.json dependencies from caniuse-lite\n' +
    yellow('$ ' + del + ' caniuse-lite') + '\n'
  )
  childProcess.execSync(del + ' caniuse-lite')

  print('caniuse-lite has been successfully updated\n')

  var currentBrowsersList
  if (!browsersListRetrievalError) {
    try {
      currentBrowsersList = getBrowsersList()
    } catch (e) /* istanbul ignore next */ {
      browsersListRetrievalError = e
    }
  }

  if (browsersListRetrievalError) {
    print(
      red(
        '\n' +
        browsersListRetrievalError.stack + '\n\n' +
        'Problem with browsers list retrieval.\n' +
        'Target browser changes won???t be shown.\n'
      )
    )
  } else {
    var targetBrowserChanges = diffBrowsersLists(
      oldBrowsersList,
      currentBrowsersList
    )
    if (targetBrowserChanges) {
      print('\nTarget browser changes:\n')
      print(targetBrowserChanges + '\n')
    } else {
      print('\n' + green('No target browser changes') + '\n')
    }
  }
}
