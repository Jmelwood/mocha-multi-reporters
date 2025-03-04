'use strict';

const _ = {
    get: require('lodash/get'),
    camelCase: require('lodash/camelCase'),
    size: require('lodash/size'),
    after: require('lodash/after'),
    merge: require('lodash/merge')
};
const debug = require('debug')('mocha:reporters:MultiReporters');
const fs = require('fs');
const util = require('util');
const mocha = require('mocha');
const {Base} = mocha.reporters;
const path = require('path');

let createStatsCollector;
let mocha6plus;

try {
    const json = JSON.parse(
        fs.readFileSync(`${path.dirname(require.resolve('mocha'))  }/package.json`, 'utf8')
    );
    const {version} = json;
    // istanbul ignore else
    if (version >= '6') {
        createStatsCollector = require('mocha/lib/stats-collector');
        mocha6plus = true;
    }
    else {
        mocha6plus = false;
    }
}
catch (e) {
    // istanbul ignore next
    console.warn('Couldn\'t determine Mocha version');
}

function MultiReporters(runner, options) {
    // istanbul ignore else
    if (mocha6plus) {
        createStatsCollector(runner);
    }
    Base.call(this, runner);

    if (_.get(options, 'execute', true)) {
        options = this.getOptions(options);

        let enabledReporters = _.get(options, 'reporterEnabled', 'tap');
        if (!Array.isArray(enabledReporters)) {
            enabledReporters = enabledReporters.split(',');
        }

        this._reporters = enabledReporters.map(
            function processReporterEnabled(name, index) {
                debug(name, index);

                name = name.trim();

                const reporterOptions = this.getReporterOptions(options, name);

                //
                // Mocha Reporters
                // https://github.com/mochajs/mocha/blob/master/lib/reporters/index.js
                //
                let Reporter = _.get(mocha, ['reporters', name], null);

                //
                // External Reporters.
                // Try to load reporters from process.cwd() and node_modules.
                //
                if (Reporter === null) {
                    let originalError;
                    try {
                        Reporter = require(name);
                    }
                    catch (err) {
                        originalError = err;
                        const qualifiedFile = path.resolve(process.cwd(), name);
                        try {
                            Reporter = require(qualifiedFile);
                        }
                        catch (_err) {
                            console.error(`Failed to load reporter: "${name}" or "${qualifiedFile}": ${originalError.stack}`);
                        }
                    }
                }

                if (Reporter !== null) {
                    return new Reporter(
                        runner, {
                            reporterOptions
                        }
                    );
                }
                else {
                    console.error('Reporter not found!', name);
                }
            },
            this
        );
    }
}

util.inherits(MultiReporters, Base);

MultiReporters.CONFIG_FILE = '../config.json';

MultiReporters.prototype.done = function (failures, fn) {
    const numberOfReporters = _.size(this._reporters);

    if (numberOfReporters === 0) {
        console.error('Unable to invoke fn(failures) - no reporters were registered');
        return;
    }

    const reportersWithDoneHandler = this._reporters.filter(function (reporter) {
        return reporter && (typeof reporter.done === 'function');
    });

    const numberOfReportersWithDoneHandler = _.size(reportersWithDoneHandler);

    if (numberOfReportersWithDoneHandler === 0) {
        return fn(failures);
    }

    const done = _.after(numberOfReportersWithDoneHandler, function() {
        fn(failures);
    });

    reportersWithDoneHandler.forEach(function(reporter) {
        reporter.done(failures, done);
    });
};

MultiReporters.prototype.getOptions = function (options) {
    debug('options', options);

    const mmrOutput = _.get(options, 'reporterOptions.mmrOutput') || _.get(options, 'reporterOptions.cmrOutput');
    const resultantOptions = _.merge({}, this.getDefaultOptions(), this.getCustomOptions(options), mmrOutput ? {mmrOutput} : null);

    debug('options file (resultant)', resultantOptions);
    return resultantOptions;
};

MultiReporters.prototype.getCustomOptions = function (options) {
    let customOptionsFile = _.get(options, 'reporterOptions.configFile');
    debug('options file (custom)', customOptionsFile);

    let customOptions;
    if (customOptionsFile) {
        customOptionsFile = path.resolve(customOptionsFile);
        debug('options file (custom)', customOptionsFile);

        try {
            if ('.js' === path.extname(customOptionsFile) || '.cjs' === path.extname(customOptionsFile)) {
                customOptions = require(customOptionsFile);
            }
            else {
                customOptions = JSON.parse(fs.readFileSync(customOptionsFile).toString());
            }

            debug('options (custom)', customOptions);
        }
        catch (e) {
            console.error(e);
            throw e;
        }
    }
    else {
        customOptions = _.get(options, 'reporterOptions');
    }

    return customOptions;
};

MultiReporters.prototype.getDefaultOptions = function () {
    const defaultOptionsFile = require.resolve(MultiReporters.CONFIG_FILE);
    debug('options file (default)', defaultOptionsFile);

    let defaultOptions = fs.readFileSync(defaultOptionsFile).toString();
    debug('options (default)', defaultOptions);

    try {
        defaultOptions = JSON.parse(defaultOptions);
    }
    catch (e) {
        console.error(e);
        throw e;
    }

    return defaultOptions;
};

MultiReporters.prototype.getReporterOptions = function (options, name) {
    const _name = name;
    const commonReporterOptions = _.get(options, 'reporterOptions', {});
    debug('reporter options (common)', _name, commonReporterOptions);

    name = [_.camelCase(name), 'ReporterOptions'].join('');
    const customReporterOptions = _.get(options, [name], {});
    debug('reporter options (custom)', _name, customReporterOptions);

    const resultantReporterOptions = _.merge({}, commonReporterOptions, customReporterOptions);
    debug('reporter options (resultant)', _name, resultantReporterOptions);

    let mmrOutput = _.get(options, 'mmrOutput') || _.get(options, 'cmrOutput');
    if (mmrOutput) {
        if (!Array.isArray(mmrOutput)) {
            mmrOutput = mmrOutput.split(':').map((mmrOutputReporter) => {
                return mmrOutputReporter.split('+');
            });
        }
        mmrOutput.forEach(([targetName, prop, output]) => {
            if (resultantReporterOptions[prop] && _name === targetName) {
                resultantReporterOptions[prop] = resultantReporterOptions[prop].replace(/\{id\}/gu, output);
            }
        });
    }

    return resultantReporterOptions;
};

module.exports = MultiReporters;
