import json
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import redis
from app.services import ai_response_cache as cache
from app.services import openai_client as client


class FakeRedis:
    def __init__(self):
        self.data = {}
    def get(self, key):
        return self.data.get(key)
    def set(self, key, value, nx=False, ex=None):
        if nx and key in self.data:
            return False
        self.data[key] = value
        return True
    def eval(self, script, count, key, token):
        if self.data.get(key) == token:
            self.data.pop(key)


class CacheTests(unittest.TestCase):
    def setUp(self):
        cache._memory.clear()
        self.redis = FakeRedis()
        self.patch = patch.object(cache, '_redis', return_value=self.redis)
        self.patch.start()
        self.addCleanup(self.patch.stop)
    def key(self, value='one', scope='teacher'):
        return cache.cache_key('private-key', {'input': value, 'model': 'gpt-4o'}, scope)
    def test_concurrent_exact_requests_only_pay_once(self):
        calls = []
        def generate():
            calls.append(1)
            time.sleep(.03)
            return 'full answer'
        with ThreadPoolExecutor(max_workers=8) as pool:
            values = list(pool.map(lambda _: cache.reuse(self.key(), generate, bool), range(8)))
        self.assertEqual(len(calls), 1)
        self.assertEqual(sum(hit for _, hit in values), 7)
        self.assertTrue(all(t == 'full answer' for t, _ in values))
    def test_bypass_and_changed_inputs(self):
        cache.reuse(self.key(), lambda: 'old', bool)
        self.assertEqual(cache.reuse(self.key(), lambda: 'new', bool, bypass=True), ('new', False))
        self.assertEqual(cache.reuse(self.key(), lambda: 'wrong', bool), ('new', True))
        self.assertNotEqual(self.key(), self.key('different'))
        self.assertNotEqual(self.key(), self.key(scope='other'))
        self.assertNotIn('private-key', self.key())
        self.assertNotEqual(self.key(), cache.cache_key('other-key', {'input': 'one', 'model': 'gpt-4o'}, 'teacher'))
    def test_invalid_and_failed_results_not_cached(self):
        calls = []
        def generate():
            calls.append(1)
            return 'partial'
        for _ in range(2):
            cache.reuse(self.key(), generate, lambda t: False)
        self.assertEqual(len(calls), 2)
        def fail():
            raise ValueError('failed')
        with self.assertRaises(ValueError):
            cache.reuse(self.key(), fail, bool)
        self.assertNotIn(self.key() + ':lock', self.redis.data)
    def test_redis_failure_fallback_preserves_full_result(self):
        def fail(_):
            raise redis.ConnectionError()
        self.redis.get = fail
        self.assertEqual(cache.reuse(self.key(), lambda: 'full', bool), ('full', False))
        self.assertEqual(cache.reuse(self.key(), lambda: 'wrong', bool), ('full', True))
    def test_fresh_generation_and_truncation(self):
        messages = [{'role': 'user', 'content': 'new case'}]
        response = {'choices': [{'message': {'content': 'full'}, 'finish_reason': 'stop'}]}
        with patch.object(client, '_http_post', return_value=response) as post, patch.object(client, '_log_usage'):
            for _ in range(2):
                client.generate_openai_chat('key', messages=messages, usage_kind='case_generate')
            self.assertEqual(post.call_count, 2)
            self.assertEqual(post.call_args.args[1]['messages'], messages)
            response['choices'][0]['finish_reason'] = 'length'
            with self.assertRaises(client.OpenAiClientError):
                client.generate_openai_chat('key', messages=messages)
    def test_translation_requires_complete_mapping(self):
        source = {'topic': 'topic', 'questions': [{'question': 'q', 'options': ['a', 'b'], 'correctOptionIndex': 1, 'explanation': 'why'}]}
        valid = cache.transformation_validator('test_translate', [{'role': 'user', 'content': json.dumps(source)}])
        self.assertTrue(valid(json.dumps(source)))
        source['questions'][0]['correctOptionIndex'] = 0
        self.assertFalse(valid(json.dumps(source)))
        self.assertFalse(valid('{broken'))
    def test_variant_indices_must_be_unique_and_complete(self):
        source = [{'id': 4, 'options': [{'i': 0}, {'i': 1}]}]
        valid = cache.transformation_validator('test_option_explanations', [{'role': 'user', 'content': json.dumps(source)}])
        result = {'items': [{'id': 4, 'analysis': 'full reasoning', 'explanations': [{'i': 1, 'text': 'wrong'}, {'i': 0, 'text': 'right'}]}]}
        self.assertTrue(valid(json.dumps(result)))
        result['items'][0]['explanations'][1]['i'] = 1
        self.assertFalse(valid(json.dumps(result)))
    def test_ocr_character_preservation(self):
        valid = cache.transformation_validator('topic_text_repair', [{'role': 'user', 'content': '["Cellmembrane"]'}])
        self.assertTrue(valid('["Cell membrane"]'))
        self.assertFalse(valid('["Cell membranes"]'))


if __name__ == '__main__':
    unittest.main()
