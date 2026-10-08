import os
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from products import Products  # noqa: E402
from store import Store  # noqa: E402

SPACE = "p-7f3k2b9c4d"
TABLE = "Project-test"
BUCKET = "project-docs-test"


@pytest.fixture
def aws():
    os.environ.update(
        AWS_ACCESS_KEY_ID="testing",
        AWS_SECRET_ACCESS_KEY="testing",
        AWS_DEFAULT_REGION="eu-central-1",
    )
    with mock_aws():
        s3 = boto3.client("s3")
        s3.create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "eu-central-1"})
        s3.put_bucket_versioning(Bucket=BUCKET, VersioningConfiguration={"Status": "Enabled"})
        db = boto3.client("dynamodb")
        db.create_table(
            TableName=TABLE,
            KeySchema=[{"AttributeName": "slug", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "slug", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        db.put_item(TableName=TABLE, Item={"slug": {"S": SPACE}, "name": {"S": "PermTek-5"}})
        yield s3, db


@pytest.fixture
def store(aws):
    return Store(BUCKET, aws[0])


@pytest.fixture
def products(aws):
    return Products(TABLE, aws[1])
