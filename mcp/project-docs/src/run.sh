#!/bin/bash
# Entry point behind the AWS Lambda Web Adapter (AWS_LAMBDA_EXEC_WRAPPER).
# The adapter starts this, waits for /healthz, then forwards each invocation
# to uvicorn as an ordinary HTTP request.
PATH=$PATH:$LAMBDA_TASK_ROOT/bin \
PYTHONPATH=$LAMBDA_TASK_ROOT:$PYTHONPATH \
  exec python -m uvicorn --host 127.0.0.1 --port "$AWS_LWA_PORT" --no-access-log app:app
