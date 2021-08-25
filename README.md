## Amazon ECS Service Action for GitHub Actions
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg)](https://github.com/semantic-release/semantic-release)

Creates an Amazon ECS Service

**Table of Contents**

<!-- toc -->

- [Amazon ECS Service Action for GitHub Actions](#amazon-ecs-service-action-for-github-actions)
- [Usage](#usage)
  - [Service Creation / Update](#service-creation--update)
  - [Service Deletion](#service-deletion)
- [Credentials and Region](#credentials-and-region)
- [Permissions](#permissions)
- [Troubleshooting](#troubleshooting)

<!-- tocstop -->

## Usage

### Service Creation / Update

Create or update an ECS Service.

parameter              | description                                 | default
-----------------------|---------------------------------------------|----------
`spec` and `spec-file` | Specify either a `spec-file` as a filename, a `spec` as a JSON string, or both. See notes below and https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-ecs/interfaces/createservicecommandinput.html for information about how to craft a valid `spec` or `spec-file`. | {}
`force-new-deployment` | Whether to force a new deployment when updating the service as a boolean. | `false`
`wait-until-tasks-running` | Whether to wait for the tasks to enter a running state. | `false`


```yaml

- name: Register Task Definition
  id: task-definition
  uses: aws-actions/amazon-ecs-deploy-task-definition@v1
  with:
    task-definition: some-task-definition.json

- name: ECS Service
  uses: scribd/amazon-ecs-service@master
  with:
    spec-file: examples/service-spec.json
    spec: |
      {
        "taskDefinition": "${{ steps.task-definition.outputs.task-definition-arn }}"
      }
    force-new-deployment: false
    wait-until-tasks-running: true

```

#### **A note on using both `spec-file` and `spec`**:

This merge functionality is intended to provide very basic addition of simple elements to the spec-file. Please try to avoid using this effect for complicated transformations.

```
  spec-file + spec => combined-spec-data                                                   // The combined-spec-data is sent to the AWS API.
  {"a": "b"} + {"a": "c"} => {"a": "c"}                                                    // The algorithm naiively replaces the top level keys in the combined spec.
  {"a": "b"} + {"c": "d"} => {"a": "b", "c": "d"}                                          // If you add a key, no problem.
  {"a": {"b": "c", "d": "e"}} + {"a": {"d": "f"}} => {"a": {"d": "f"}}                     // If you change an element in a lower level key, data is lost. Note how "b" is lost. 
  {"a": {"b": "c", "d": "e"}} + {"a": {"b": "c", "d": "f"}} => {"a": {"b": "c", "d": "f"}} // If you change an element in a lower level key, recreate the other elements.
  {"a": "b"} + ?????? => {}                                                                // There is no way to delete elements. 
```

### Service Deletion

The minimum values necessary to delete a service are the cluster name or arn, and the serviceName. You can also specify the same create spec, and the action will convert the parameters automatically.

parameter              | description                                 | default
-----------------------|---------------------------------------------|----------
`spec` and `spec-file` | The bare minimum is `{"cluster": "my-cluster", "serviceName": "my-service"}`  | {}
`action` | Whether to `create` or `delete` the service | `create`
`force-delete` | If true, allows you to delete a service even if it has not been scaled down to zero tasks. It is only necessary to use this if the service is using the REPLICA scheduling strategy. | `false`


```yaml

- name: Delete ECS Service
  uses: scribd/amazon-ecs-service@master
  with:
    spec: |
      {"cluster": "my-cluster", "serviceName": "my-service"}
    action: delete
    force-delete: false


// Or just recycle the spec-file from the create-side. 

- name: Delete ECS Service
  uses: scribd/amazon-ecs-service@master
  with:
    spec-file: examples/service-spec.json
    action: delete
    force-delete: false
```

See [action.yml](action.yml) for more information on this action's inputs and outputs.


## Credentials and Region

This action relies on the [default behavior of the AWS SDK for Javascript](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html) to determine AWS credentials and region.
Use [the `aws-actions/configure-aws-credentials` action](https://github.com/aws-actions/configure-aws-credentials) to configure the GitHub Actions environment with environment variables containing AWS credentials and your desired region.

We recommend following [Amazon IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) for the AWS credentials used in GitHub Actions workflows, including:
* Do not store credentials in your repository's code.  You may use [GitHub Actions secrets](https://help.github.com/en/actions/automating-your-workflow-with-github-actions/creating-and-using-encrypted-secrets) to store credentials and redact credentials from GitHub Actions workflow logs.
* [Create an individual IAM user](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#create-iam-users) with an access key for use in GitHub Actions workflows, preferably one per repository. Do not use the AWS account root user access key.
* [Grant least privilege](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#grant-least-privilege) to the credentials used in GitHub Actions workflows.  Grant only the permissions required to perform the actions in your GitHub Actions workflows.  See the Permissions section below for the permissions required by this action.
* [Rotate the credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#rotate-credentials) used in GitHub Actions workflows regularly.
* [Monitor the activity](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#keep-a-log) of the credentials used in GitHub Actions workflows.

## Permissions

This action requires the following minimum set of permissions:

```json
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Sid":"DeployService",
      "Effect":"Allow",
      "Action":[
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DeleteService",
        "ecs:CreateService"
      ],
      "Resource":[
        "arn:aws:ecs:us-east-1:1234567890:mesh/my-mesh/virtualServicer/my-virtual-servicer/service/my-service"
      ]
    }
  ]
}
```


## Troubleshooting

This action emits debug logs to help troubleshoot deployment failures.  To see the debug logs, create a secret named `ACTIONS_STEP_DEBUG` with value `true` in your repository.

To run this action from your workstation, you have to take into account the following bug: BASH doesn't think dashes are valid in environment variables, but Node does. You should therefore supply your environment variables with the `env` command.

Please include output from the following commands when submitting issues, it'll help greatly! Don't forget to redact any sensitive data from your submission.

See this example:

```bash
❯  env "ACTIONS_STEP_DEBUG=true" "GITHUB_WORKSPACE=$(pwd)" 'AWS_REGION=us-east-1' 'INPUT_SPEC={"serviceName": "my-service"}' node  index.js
```

# Development

Releases are cut using [semantic-release](https://github.com/semantic-release/semantic-release).

Please write commit messages following [Angular commit guidelines](https://github.com/angular/angular.js/blob/master/DEVELOPERS.md#-git-commit-guidelines)
