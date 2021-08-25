const core = require('@actions/core');
const fs = require('fs');
const {ECSClient, CreateServiceCommand, DescribeServicesCommand, UpdateServiceCommand, DeleteServiceCommand, waitUntilServicesInactive, waitUntilTasksRunning} = require('@aws-sdk/client-ecs');
const _ = require('lodash');


/**
 *
 * ERRORS
 * Provides signals for controlling application behavior.
 *
 *****************************************************************************************/

/**
 * An error type representing a failure to find a Service
 * @extends Error
 */
class NotFoundException extends Error {
  /**
   * @param {String} message Error message
   */
  constructor(message) {
    super(message);
    this.name = 'NotFoundException';
    this.message = message;
    this.stack = (new Error()).stack;
  }
}

/**
 * An error type representing a need to recreate a Service
 * @extends Error
 */
class Draining extends Error {
  /**
   * @param {String} message Error message
   */
  constructor(message) {
    super(message);
    this.name = 'Draining';
    this.message = message;
    this.stack = (new Error()).stack;
  }
}

/**
 * An error type representing a need to recreate a Service
 * @extends Error
 */
class NeedsReplacement extends Error {
  /**
   * @param {String} message Error message
   */
  constructor(message) {
    super(message);
    this.name = 'NeedsReplacement';
    this.message = message;
    this.stack = (new Error()).stack;
  }
}


/**
 *
 * WAITERS
 *
 *****************************************************************************************/

/**
 * Wait for Service to become INACTIVE.
 * @param {@aws-sdk/client-ecs/ECSClient} client client
 * @param {Object} parameters Original parameters
 */
async function doWaitUntilServiceInactive(client, parameters) {
  core.info('...Waiting up to one hour for service to become INACTIVE...');
  const result = await waitUntilServicesInactive({client, maxWaitTime: 3600}, describeInput(parameters));
  if (result.state === 'SUCCESS') {
    core.info('...service is INACTIVE...');
  } else {
    throw new Error(`Service ${parameters.spec.serviceName} failed to delete: ${JSON.stringify(result)}`);
  }
}

/**
 * Wait for Tasks to become RUNNING.
 * @param {@aws-sdk/client-ecs/ECSClient} client client
 * @param {Object} parameters Original parameters
 */
async function waitUntilTasksRunningIfCalledFor(client, parameters) {
  if (parameters.waitUntilTasksRunning) {
    core.info('...Waiting up to one hour for tasks to enter a RUNNING state...');
    const result = await waitUntilTasksRunning({client, maxWaitTime: 3600}, describeInput(parameters));
    if (result.state === 'SUCCESS') {
      core.info('...tasks are RUNNING...');
    } else {
      throw new Error(`Tasks ${parameters.spec.serviceName} failed to start: ${JSON.stringify(result)}`);
    }
  }
}


/**
 *
 * PARAMETER CONVERSION
 * Converts the supplied (create) parameters into the formats for describe, update, and delete.
 *
 *****************************************************************************************/

/**
 * return only defined properties
 * @param {Object} obj
 * @return {Object} sans keynames with 'undefined' values'
 */
function omitUndefined(obj) {
  return _.pickBy(obj, (value, key) => {
    return value !== undefined;
  });
}

/**
 * Filter parameters according to createService API
 * @param {Object} parameters Original parameters
 * @return {Object} Filtered parameters
 */
function createInput(parameters) {
  return omitUndefined(
      {
        capacityProviderStrategy: parameters.spec.capacityProviderStrategy,
        clientToken: parameters.spec.clientToken,
        cluster: parameters.spec.cluster,
        deploymentConfiguration: parameters.spec.deploymentConfiguration,
        deploymentController: parameters.spec.deploymentController,
        desiredCount: parameters.spec.desiredCount,
        enableECSManagedTags: parameters.spec.enableECSManagedTags,
        enableExecuteCommand: parameters.spec.enableExecuteCommand,
        healthCheckGracePeriodSeconds: parameters.spec.healthCheckGracePeriodSeconds,
        launchType: parameters.spec.launchType,
        loadBalancers: parameters.spec.loadBalancers,
        networkConfiguration: parameters.spec.networkConfiguration,
        placementConstraints: parameters.spec.placementConstraints,
        placementStrategy: parameters.spec.placementStrategy,
        platformVersion: parameters.spec.platformVersion,
        propagateTags: parameters.spec.propagateTags,
        role: parameters.spec.role,
        schedulingStrategy: parameters.spec.schedulingStrategy,
        serviceName: parameters.spec.serviceName,
        serviceRegistries: parameters.spec.serviceRegistries,
        tags: parameters.spec.tags,
        taskDefinition: parameters.spec.taskDefinition,
      },
  );
}


/**
 * Filter parameters according to describeService API
 * @param {Object} parameters Original parameters
 * @return {Object} Filtered parameters
 */
function describeInput(parameters) {
  return {
    cluster: parameters.spec.cluster,
    include: ['TAGS'],
    services: [parameters.spec.serviceName],
  };
}

/**
 * Filter parameters according to [@aws-sdk/client-ecs/UpdateServiceCommandInput}](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ecs/interfaces/updateservicecommandinput.html)
 * @param {Object} parameters Original parameters
 * @return {Object} Filtered parameters
 */
function updateInput(parameters) {
  return omitUndefined(
      {
        capacityProviderStrategy: parameters.spec.capacityProviderStrategy,
        cluster: parameters.spec.cluster,
        deploymentConfiguration: parameters.spec.deploymentConfiguration,
        desiredCount: parameters.spec.desiredCount,
        enableExecuteCommand: parameters.spec.enableExecuteCommand,
        forceNewDeployment: parameters.forceNewDeployment,
        healthCheckGracePeriodSeconds: parameters.spec.healthCheckGracePeriodSeconds,
        networkConfiguration: parameters.spec.networkConfiguration,
        placementConstraints: parameters.spec.placementConstraints,
        placementStrategy: parameters.spec.placementStrategy,
        platformVersion: parameters.spec.platformVersion,
        service: parameters.spec.serviceName,
        taskDefinition: parameters.spec.taskDefinition,
      },
  );
}

/**
 * Filter parameters according to deleteService API
 * @param {Object} parameters Original parameters
 * @return {Object} Filtered parameters
 */
function deleteInput(parameters) {
  return omitUndefined(
      {
        cluster: parameters.spec.cluster,
        service: parameters.spec.serviceName,
        force: parameters.forceDelete,
      },
  );
}


/**
 *
 * DELETE
 *
 *****************************************************************************************/

/**
 * Delete Service or throw an error
 * @param {@aws-sdk/client-ecs/ECSClient} client client
 * @param {Object} parameters Original parameters
 * @return {Promise} that resolves to {@aws-sdk/client-ecs/CreateServiceCommandOutput}
 */
async function deleteService(client, parameters) {
  if (!parameters.forceDelete) {
    core.info('Reducing Service\'s desired count to 0');
    const updateParameters = {...parameters, spec: {...parameters.spec, desiredCount: 0}};
    await updateService(client, updateParameters);
  }
  const command = new DeleteServiceCommand(deleteInput(parameters));
  const response = await client.send(command);

  core.info(`Deleted ${parameters.spec.serviceName}.`);
  await doWaitUntilServiceInactive(client, parameters);

  const found = findServiceInResponse(response, parameters.spec.serviceName, false);
  return found;
}


/**
 *
 * UPDATE
 *
 *****************************************************************************************/

/**
 * Determine the delta between the current and desired Service
 * @param {@aws-sdk/client-ecs/Service} currentService Service
 * @param {Object} parameters Original parameters
 * @return {Object} The proposed input to the updateService command
 */
function whatsTheDiff(currentService, parameters) {
  const updateParams = updateInput(parameters);
  const difference = {};
  Object.keys(updateParams).forEach((key) => {
    if (!_.isEqual(currentService[key], updateParams[key])) {
      difference[key] = updateParams[key];
    }
  });
  return difference;
}

/**
 * Determine if Service needs update
 * @param {@aws-sdk/client-ecs/Service} currentService Service
 * @param {Object} parameters Original parameters
 * @return {Array} [true, updateParameters] if update needed, [false, updateParameters] otherwise
 */
function updateNeeded(currentService, parameters) {
  const difference = whatsTheDiff(currentService, parameters);

  // True if the Service needs to be updated
  // False if the difference is just the 2 idenfitying parameters.
  // `cluster` and `service` are given as parameters, but not returned by AWS.
  // So these will always be different in that they exist on the right side, but not the left side.
  const changes = !_.isEqual(difference, {cluster: parameters.spec.cluster, service: parameters.spec.serviceName});
  return [changes, difference];
}

/**
 * Determine if update shape is valid according to API constraints found in
 * https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ecs/classes/updateservicecommand.html
 * @param {@aws-sdk/client-ecs/Service} currentService Service
 * @param {Object} updateParams Parameters describing the update
 * @return {Array} [true, []]] if update shape is valid, [false, additionalKeys] otherwise
 */
function isUpdateShapeValid(currentService, updateParams) {
  const commonKeys = ['cluster', 'desiredCount', 'forceNewDeployment', 'placementConstraints', 'placementStrategy', 'service'];
  const ecsAvailableKeys = ['deploymentConfiguration', 'networkConfiguration', 'taskDefinition'];
  const codeDeployAvailableKeys = ['deploymentConfiguration', 'healthCheckGracePeriodSeconds'];
  const externalAvailableKeys = ['healthCheckGracePeriodSeconds'];

  const deploymentController = currentService.deploymentController;

  let additionalKeys;
  if (deploymentController == 'CODE_DEPLOY') {
    additionalKeys = _.difference(Object.keys(updateParams), commonKeys, codeDeployAvailableKeys);
  } else if (deploymentController == 'EXTERNAL') {
    additionalKeys = _.difference(Object.keys(updateParams), commonKeys, externalAvailableKeys);
  } else {
    // Default for undefined deploymentController is 'ECS'
    additionalKeys = _.difference(Object.keys(updateParams), commonKeys, ecsAvailableKeys);
  }

  if (_.isEmpty(additionalKeys)) {
    return [true, []];
  } else {
    return [false, additionalKeys];
  }
}

/**
 * Update Service or throw an error
 * @param {@aws-sdk/client-ecs/ECSClient} client client
 * @param {Object} parameters Original parameters
 * @return {Promise} that resolves to {@aws-sdk/client-ecs/CreateServiceCommandOutput}
 */
async function updateService(client, parameters) {
  const command = new UpdateServiceCommand(updateInput(parameters));
  const response = await client.send(command);
  await waitUntilTasksRunningIfCalledFor(client, parameters);
  const found = findServiceInResponse(response, parameters.spec.serviceName);
  core.info(`Updated ${parameters.spec.serviceName}.`);
  return found;
}


/**
 *
 * FIND
 *
 *****************************************************************************************/

function handlefindServiceInResponseErrors(response, serviceName) {
  if (hasMissingFailure(response)) {
    throw new NotFoundException(`Service ${serviceName} not found.`);
  }
  if (hasOtherFailures(response)) {
    throw new Error(`findServiceInResponse: ${serviceName} has failures. See: ${JSON.stringify(response)}`);
  }
}

// Response parsing
/* eslint-disable require-jsdoc */
function findInDescribeServiceCommandOutput(response, serviceName) {
  if (response && response.services) {
    return response.services.find((service) => service.serviceName === serviceName);
  }
  return false;
}

// CreateServicesCommandOutput / UpdateServiceCommandOutput / DeleteServiceCommandOutput
function findInCreateServiceCommandOutput(response) {
  if (response && response.service) {
    return response.service;
  }
  return false;
}

function hasMissingFailure(response) {
  return response.failures && response.failures.find((failure) => failure.reason === 'MISSING');
}

function hasOtherFailures(response) {
  return response.failures && response.failures.length > 0;
}

/* eslint-enable require-jsdoc */

/**
 * Find Service
 * @param {@aws-sdk/client-ecs/DescribeServicesCommandOutput} response Response from DescribeServicesCommand or CreateServicesCommand
 * @param {String} serviceName Name of the service
 * @param {Boolean} statusCheck Whether to check the status of the service. True by default.
 * @return {@aws-sdk/client-ecs/Service} or throw one of [NotFoundException, Draining, Error]
 */
function findServiceInResponse(response, serviceName, statusCheck = true) {
  handlefindServiceInResponseErrors(response, serviceName);

  let found = findInDescribeServiceCommandOutput(response, serviceName);

  if (!found) {
    found = findInCreateServiceCommandOutput(response);
  }

  // If found and we have a status...
  if (found && found.status && statusCheck) {
    if (found.status === 'ACTIVE') {
      return found;
    } else if (found.status === 'INACTIVE') {
      throw new NotFoundException(`Service ${serviceName} is inactive and should be recreated.`);
    } else if (found.status === 'DRAINING') {
      throw new Draining('Service is draining and should be recreated.');
    } else {
      throw new Error(`findServiceInResponse: ${serviceName} has an unexpected status: ${found.status}`);
    }
  }

  // If found and we don't have a status to check...
  if (found) {
    return found;
  }
  // Not found...
  throw new NotFoundException(`Service ${serviceName} not found.`);
}

/**
 * Fetch Service or throw an error
 * @param {@aws-sdk/client-ecs/ECSClient} client client
 * @param {Object} parameters Original parameters
 * @return {Promise} that resolves to {@aws-sdk/client-ecs/DescribeServiceCommandOutput
 */
async function describeService(client, parameters) {
  const command = new DescribeServicesCommand(describeInput(parameters));
  const response = await client.send(command);
  const found = findServiceInResponse(response, parameters.spec.serviceName);
  core.info(`Found ${parameters.spec.serviceName}.`);
  return found;
}


/**
 *
 * CREATE
 *
 *****************************************************************************************/


/**
 * Create Service or throw an error
 * @param {@aws-sdk/client-ecs/ECSClient} client client
 * @param {Object} parameters Original parameters
 * @return {Promise} that resolves to {@aws-sdk/client-ecs/CreateServiceCommandOutput}
 */
async function createService(client, parameters) {
  const command = new CreateServiceCommand(createInput(parameters));
  const response = await client.send(command);
  await waitUntilTasksRunningIfCalledFor(client, parameters);
  const found = findServiceInResponse(response, parameters.spec.serviceName);
  core.info(`Created ${parameters.spec.serviceName}.`);
  return found;
}


/**
 *
 * FIND / CREATE / UPDATE (Logic)
 *
 *****************************************************************************************/


/**
 * Respond to errors from findServiceInResponse.
 * @param {@aws-sdk/client-ecs/ECSClient} client client
 * @param {Object} parameters Original parameters
 * @param {Error} err Error
 * @return {Promise} that resolves to {@aws-sdk/client-ecs/DescribeServiceCommandOutput} or {@aws-sdk/client-ecs/CreateServiceCommandOutput}
 */
async function handlefindCreateOrUpdateServiceErrors(client, parameters, err) {
  if (err.name === 'NotFoundException') {
    core.info(`Unable to find ${parameters.spec.serviceName}. Creating newly.`);
    return await createService(client, parameters);
  } else if (err.name === 'Draining') {
    core.info(`Service ${parameters.spec.serviceName} is draining. Creating newly after waiting up to an hour for it to enter an INACTIVE state...`);
    await doWaitUntilServiceInactive({client, maxWaitTime: 3600}, parameters);
    core.info('...service is now INACTIVE...');
    return await createService(client, parameters);
  } else {
    throw err;
  }
}

/**
 * Find or create the Service
 * @param {@aws-sdk/client-ecs/ECSClient} client client
 * @param {Object} parameters Original parameters
 * @return {Promise} that resolves to {@aws-sdk/client-ecs/DescribeServiceCommandOutput} or {@aws-sdk/client-ecs/CreateServiceCommandOutput}
 */
async function findCreateOrUpdateService(client, parameters) {
  core.info(`Looking for Service: ${parameters.spec.serviceName}`);
  const found = await describeService(client, parameters).catch((err) => {
    return handlefindCreateOrUpdateServiceErrors(client, parameters, err);
  });

  const [changes, updateParams] = updateNeeded(found, parameters);
  if (changes) {
    const [valid, additionalKeys] = isUpdateShapeValid(found, updateParams);
    if (valid) {
      core.info(`Found, but update needed. Updating ${parameters.spec.serviceName} with: ${JSON.stringify(updateParams)}`);
      return await updateService(client, parameters);
    } else {
      throw new NeedsReplacement(`The Service needs to be replaced, as the following changes cannot be made: ${JSON.stringify(_.at(updateParams, additionalKeys))}.`);
    }
  } else {
    core.info(`Found ${parameters.spec.serviceName}. No further action needed.`);
    return found;
  }
}


/**
 *
 * GITHUB ACTIONS INTERFACE
 * - Gets parameters from the user.
 * - Posts results as output.
 *
 *****************************************************************************************/

/**
 * @param {Error} err The original error
 * @param {String} param The parameter that was being evaluated
 * @param {String} s The supplied string
 * @return {Error} The Error indicating invalid JSON, if JSON, else err.
 */
function handleGetParameterErrors(err, param, s) {
  if (err instanceof SyntaxError) {
    return new Error(`Invalid JSON for ${param}: ${err.message}: ${s}`);
  } else if (err.code === 'ENOENT') {
    return new Error(`Unable to open ${param}: ${err.message}`);
  } else {
    return err;
  }
}

/**
 * @param {Object} parameters Parameters
 * @return {Object} The same parameters or undefined
 */
function validateParameters(parameters) {
  const requiredKeys = ['serviceName'];

  if (!parameters.spec) {
    throw new Error('Either `spec` or `spec-file` are required.');
  }
  const containsAllRequiredKeys = requiredKeys.every((key) => Boolean(parameters.spec[key]));
  if (!containsAllRequiredKeys) {
    throw new Error('Parameters missing from `spec`. Required keys: ' + requiredKeys.join(', '));
  }

  return parameters;
}

/**
 * Fetch parameters pertinent to creating the Service
 * @return {Object} parameters
 */
function getParameters() {
  const parameters = {
    action: core.getInput('action', {required: false}) || 'create', // create or delete
    forceNewDeployment: core.getInput('force-new-deployment', {required: false}), // for update only
    forceDelete: core.getInput('force-delete', {required: false}), // for delete only
    waitUntilTasksRunning: core.getInput('wait-until-tasks-running', {required: false}), // for create or update only
  };

  specFile = core.getInput('spec-file', {required: false});
  if (specFile) {
    let specFileData;
    try {
      fileData = fs.readFileSync(specFile, 'utf8');
      specFileData = JSON.parse(fileData);
    } catch (err) {
      throw handleGetParameterErrors(err, 'spec-file', fileData);
    }
    Object.assign(parameters, {spec: specFileData});
  }

  spec = core.getInput('spec', {required: false});
  if (spec) {
    let specData;
    try {
      specData = JSON.parse(spec);
    } catch (err) {
      throw handleGetParameterErrors(err, 'spec', spec);
    }
    Object.assign(parameters, {spec: Object.assign({}, parameters.spec, specData)});
  }

  tags = core.getInput('tags', {required: false});
  if (tags) {
    let tagsData;
    try {
      tagsData = JSON.parse(tags);
    } catch (err) {
      throw handleGetParameterErrors(err, 'tags', tagsData);
    }
    Object.assign(parameters, {tags: tagsData});
  }

  const filteredParams = _.pickBy(
      parameters,
      (value, key) => {
        return value !== '';
      },
  );

  return validateParameters(filteredParams);
}

/**
 * Posts the results of the action to GITHUB_ENV
 * @param {@aws-sdk/client-ecs/Service} service Service
 */
function postToGithub(service) {
  const arn = service.serviceArn;

  if (arn) {
    core.info('ARN found, created, updated, or deleted: ' + arn);
    core.setOutput('service', JSON.stringify(service));
    core.setOutput('arn', arn);
  } else {
    throw new Error('Unable to determine ARN');
  }
}


/**
 *
 * ENTRYPOINT
 *
 *****************************************************************************************/

/**
 * Executes the action
 * @return {Promise} that resolves to {@aws-sdk/client-ecs/DescribeServiceCommandOutput} or {@aws-sdk/client-ecs/CreateServiceCommandOutput}
 */
async function run() {
  const client = new ECSClient({
    customUserAgent: 'amazon-ecs-service-for-github-actions',
  });

  client.middlewareStack.add((next, context) => (args) => {
    core.debug(`Middleware sending ${context.commandName} to ${context.clientName} with: ${JSON.stringify(args.request)}`);
    return next(args);
  },
  {
    step: 'build', // add to `finalize` or `deserialize` for greater verbosity
  },
  );

  // Get input parameters
  const parameters = getParameters();
  let service;
  if (parameters.action === 'create') {
    core.info('Creating / Updating Service...');
    service = await findCreateOrUpdateService(client, parameters);
  } else if (parameters.action === 'delete') {
    core.info('Deleting Service...');
    service = await deleteService(client, parameters);
  }
  core.info('...done.');

  postToGithub(service);
  return service;
}


/* istanbul ignore next */
if (require.main === module) {
  run().catch((err) => {
    core.debug(`Received error: ${JSON.stringify(err)}`);
    const httpStatusCode = err.$metadata ? err.$metadata.httpStatusCode : undefined;
    core.setFailed(`${err.name} (Status code: ${httpStatusCode}): ${err.message}`);
    core.debug(err.stack);
    process.exit(1);
  });
}


/* For testing */
module.exports = {
  createInput,
  createService,
  findCreateOrUpdateService,
  deleteService,
  deleteInput,
  describeService,
  describeInput,
  findServiceInResponse,
  getParameters,
  isUpdateShapeValid,
  omitUndefined,
  postToGithub,
  run,
  updateNeeded,
  updateService,
  updateInput,
  whatsTheDiff,
  NeedsReplacement,
  NotFoundException,
};
